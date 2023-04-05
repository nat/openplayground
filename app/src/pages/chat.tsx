import React from "react"
import NavBar from "../components/navbar"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

const initialMessages = [
  { author: "me", content: "How do I set up a Node.js TypeScript project?" },
  {
    author: "gpt-3.5",
    content: `To set up a Node.js TypeScript project, you can follow these steps:

1. Install Node.js: If you don't have Node.js installed on your computer, you can download and install it from the official website (https://nodejs.org/en/).
2. Initialize a new Node.js project: Open a terminal and navigate to the directory where you want to create your project. Then, run the following command to initialize a new Node.js project:

\`\`\`
npm init -y
\`\`\`

This will create a new \`package.json\` file in your project directory.

3. Install TypeScript: Run the following command to install TypeScript as a development dependency:

\`\`\`
npm install --save-dev typescript
\`\`\`

4. Create a TypeScript configuration file: Create a new file named \`tsconfig.json\` in your project directory with the following contents:

\`\`\`
{
  "compilerOptions": {
    "target": "es2017",
    "module": "commonjs",
    "sourceMap": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
\`\`\`

This file specifies the TypeScript compiler options and tells it to compile all files in the src directory.`,
  },
]

export default function Chat() {
  const [messages, setMessages] = React.useState(initialMessages)
  const [newMessage, setNewMessage] = React.useState("")

  function handleSubmit(evt: React.FormEvent<HTMLFormElement>) {
    evt.preventDefault()
    setMessages([...messages, { author: "me", content: newMessage }])
    setNewMessage("")
  }

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="chat" />

      <div className="border-b text-center pb-3 text-gray-500 text-sm">
        Model: Default (GPT-3.5)
      </div>

      <div className="mx-auto flex flex-col flex-1">
        <div className="flex-1">
          {messages.map((message, index) => (
            <div className="p-4">
              <div className="flex gap-4">
                <div className="bg-red-500 rounded h-8 w-8"></div>

                <div className="prose">
                  <ReactMarkdown
                    children={message.content}
                    remarkPlugins={[remarkGfm]}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <form className="p-4" onSubmit={handleSubmit}>
          <input
            className="block border rounded p-3 w-full shadow-md"
            onChange={(evt) => setNewMessage(evt.target.value)}
            placeholder="Send a message..."
            type="text"
            value={newMessage}
          />
        </form>
      </div>
    </div>
  )
}
