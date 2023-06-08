import React from "react"
import Message from "../components/chat/message"
import MessageComposer from "../components/chat/message-composer"
import ScrollContainer from "../components/chat/scroll-container"
import NavBar from "../components/navbar"

export interface IMessage {
  author: string
  content: string
}

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
] as IMessage[]

export default function Chat() {
  const [messages, setMessages] = React.useState(initialMessages)

  return (
    <div className="flex flex-col h-full">
      <NavBar tab="chat" />

      <div className="flex-1 overflow-hidden">
        <ScrollContainer>
          {messages.map((message, index) => (
            <div className="p-4" key={index}>
              <div className="mx-auto max-w-3xl">
                <Message message={message} />
              </div>
            </div>
          ))}
        </ScrollContainer>
      </div>

      <div className="p-4">
        <div className="mx-auto max-w-3xl">
          <MessageComposer
            onSubmit={(content) =>
              setMessages([...messages, { author: "me", content }])
            }
          />
        </div>
      </div>
    </div>
  )
}
