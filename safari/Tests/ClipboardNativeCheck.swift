import AppKit

@main
struct ClipboardNativeCheck {
    static func main() throws {
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let copied = SafariWebExtensionHandler.copy(["command": "copy", "png": data.base64EncodedString()], to: board)
        precondition(copied.success, copied.error ?? "PNG copy failed")
        precondition(board.data(forType: .png) == data, "PNG bytes changed")
        let refused = SafariWebExtensionHandler.copy(["command": "copy", "png": "invalid"], to: board)
        precondition(!refused.success)
        precondition(board.data(forType: .png) == data, "Invalid request changed pasteboard")
        precondition(SafariWebExtensionHandler.copy(["command": "copy", "text": "PhotoShow caption"], to: board).success)
        precondition(board.string(forType: .string) == "PhotoShow caption")
        print("Native copy passed: exact PNG bytes, invalid payload leaves contents intact, text copy. General clipboard untouched.")
    }
}
