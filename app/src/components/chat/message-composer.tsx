import { FC, useState } from "react"

interface Props {
  onSubmit: (content: string) => void
}

const MessageComposer: FC<Props> = ({ onSubmit }) => {
  const [newMessage, setNewMessage] = useState("")

  function handleSubmit(evt: React.FormEvent<HTMLFormElement>) {
    evt.preventDefault()

    if (!newMessage) return
    onSubmit(newMessage)
    setNewMessage("")
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        className="block border rounded p-3 w-full shadow-md"
        onChange={(evt) => setNewMessage(evt.target.value)}
        placeholder="Send a message..."
        type="text"
        value={newMessage}
      />
    </form>
  )
}

export default MessageComposer
