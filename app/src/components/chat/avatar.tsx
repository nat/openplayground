import { FC } from "react"

interface Props {
  name: string
}

const Avatar: FC<Props> = ({name}) => {
  const colors = ["pink", "purple", "red", "yellow", "blue", "gray", "green", "indigo"];
  const hashCode = (s:string) => s.split('').reduce((a,b) => (((a << 5) - a) + b.charCodeAt(0))|0, 0);
  const color = colors[hashCode(name) % colors.length];
  return (
    <div
      className={`bg-${color}-500 rounded h-8 w-8 flex-shrink-0`}
      title={name}
    />
  )
}

export default Avatar
