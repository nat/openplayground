import { FC, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"

interface Props {
  onSubmit: (content: string) => void
  onCancel: () => void
  disabled: boolean
}

const MessageComposer: FC<Props> = ({ onSubmit, onCancel, disabled }) => {
  const [newMessage, setNewMessage] = useState("")

  function handleSubmit() {
    if (!newMessage) return
    onSubmit(newMessage)
    setNewMessage("")
  }

  const hotkeyOptions = { preventDefault: true, enableOnFormTags: true }
  useHotkeys("enter", handleSubmit, hotkeyOptions)
  useHotkeys("esc, ctrl+c", onCancel, hotkeyOptions)

  const height = 24 * (newMessage.split("\n").length + 1)
  const style = {
    minHeight: "50px",
    maxHeight: "200px",
    height: `${height}px`,
  }

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <textarea
        className="block border rounded p-3 w-full shadow-md"
        style={style}
        onChange={(evt) => setNewMessage(evt.target.value)}
        placeholder="Send a message..."
        value={newMessage}
        rows={1}
        disabled={disabled}
      />
    </form>
  )
}

export default MessageComposer
