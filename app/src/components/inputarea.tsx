import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function InputArea() {
  return (
    <div className="grid h-96">
      <Textarea placeholder="Write tagline for a ice cream shop." />
      <Button className="inline-flex items-center px-5 py-8 text-sm font-medium text-center">
        Submit
      </Button>
    </div>
  )
}
