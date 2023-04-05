import { FC } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { IMessage } from "../../pages/chat"
import Avatar from "./avatar"

interface Props {
  message: IMessage
}

const Message: FC<Props> = ({ message }) => {
  return (
    <div className="flex gap-4">
      <Avatar />

      <div className="prose">
        <ReactMarkdown children={message.content} remarkPlugins={[remarkGfm]} />
      </div>
    </div>
  )
}

export default Message
