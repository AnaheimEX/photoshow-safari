import AppKit
import ImageIO
import SafariServices
import UniformTypeIdentifiers

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let maxImageBytes = 32 * 1024 * 1024

    func beginRequest(with context: NSExtensionContext) {
        guard let request = context.inputItems.first as? NSExtensionItem,
              let message = request.userInfo?[SFExtensionMessageKey] as? [String: Any],
              message["command"] as? String == "copy" else {
            reply(context, success: false, error: "INVALID_CLIPBOARD_PAYLOAD")
            return
        }
        // Do not log clipboard contents or read existing clipboard data.
        DispatchQueue.main.async {
            let result = Self.copy(message, to: .general)
            self.reply(context, success: result.success, error: result.error)
        }
    }

    // The same write operation can be checked using an isolated named pasteboard.
    static func copy(_ message: [String: Any], to pasteboard: NSPasteboard) -> (success: Bool, error: String?) {
        guard message["command"] as? String == "copy", let payload = validate(message) else {
            return (false, "INVALID_CLIPBOARD_PAYLOAD")
        }
        pasteboard.clearContents()
        let success = pasteboard.setData(payload.data, forType: payload.type)
        return (success, success ? nil : "CLIPBOARD_WRITE_FAILED")
    }

    private static func validate(_ message: [String: Any]) -> (data: Data, type: NSPasteboard.PasteboardType)? {
        if let text = message["text"] as? String, message["png"] == nil,
           let data = text.data(using: .utf8), data.count <= 1024 * 1024 {
            return (data, .string)
        }
        guard message["text"] == nil, let encoded = message["png"] as? String,
              encoded.utf8.count <= ((maxImageBytes + 2) / 3) * 4,
              let data = Data(base64Encoded: encoded), data.count <= maxImageBytes,
              let image = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetType(image) as String? == UTType.png.identifier,
              let properties = CGImageSourceCopyPropertiesAtIndex(image, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
              width.doubleValue > 0, height.doubleValue > 0,
              width.doubleValue * height.doubleValue <= 100_000_000 else { return nil }
        return (data, .png)
    }

    private func reply(_ context: NSExtensionContext, success: Bool, error: String?) {
        var result: [String: Any] = ["success": success]
        if let error { result["error"] = error }
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: result]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
