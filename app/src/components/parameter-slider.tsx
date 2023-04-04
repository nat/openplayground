import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip"
import React, {
  HTMLInputTypeAttribute,
  ReactElement,
  useEffect,
  useState,
  useEffect
} from "react"
import { Input } from "./ui/input"
import { Slider } from "./ui/slider"
import { useBreakpoint } from "../hooks/use-breakpoint"
import { AlertTriangle } from "lucide-react"

interface ParameterSliderProps {
  title: string
  type: HTMLInputTypeAttribute | undefined
  min: number
  max: number
  step: number
  defaultValue: number
  disabled: boolean
  normalizeInputData: (value: string) => any
  normalizeSliderData?: Function
  onChangeValue: ((value: number) => void) | undefined
  tooltipContent: ReactElement
}

const ParamaterSlider: React.FC<ParameterSliderProps> = ({
  title,
  defaultValue,
  disabled,
  min,
  max,
  step,
  normalizeInputData,
  normalizeSliderData,
  type = "number",
  tooltipContent,
  onChangeValue,
}) => {
  // TODO: deprecate this
  const [value, setValue] = useState(defaultValue) 
  const { isLg } = useBreakpoint("lg")

  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  // prevents slider from overflowing if value is > max val (can happen if user types in big number in input before unfocusing)
  const sliderValue = Math.max(
    Number(min),
    Math.min(Number(max), Number(value))
  )
  return (
    <div className="">
      <Tooltip delayDuration={300} skipDelayDuration={150}>
        <TooltipTrigger asChild>
          <div>
            <span className="cursor-default flow-root inline-block align-middle mb-3">
              <p className={`text-sm font-normal float-left align-text-top ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {(disabled) && (
                  <AlertTriangle className="w-4 h-4 text-gray-500 inline mr-1 mb-0.5" />
                )}
                {title}
              </p>
              <Input
                inputMode="decimal"
                className="float-right h-6 p-0 w-14"
                type={type}
                value={[value.toString()]}
                step={step}
                autoFocus={false}
                onChange={(e) => {
                  if (normalizeInputData) {
                    let normalized = normalizeInputData(e.target.value)
                    
                    setValue(normalized)

                    if (!isNaN(normalized) && onChangeValue) { 
                      onChangeValue(normalized)
                    }
                  }
                }}
                onBlur={(e) => {
                  let normalized = Math.max(
                    Number(min),
                    Math.min(Number(max), Number(value))
                  )
                  
                  if (isNaN(normalized)) {
                    normalized = defaultValue
                  }
                  setValue(normalized)

                  if (onChangeValue) {
                    onChangeValue(normalized)
                  }
                }}
                disabled={disabled}
                min={min}
                max={max}
              />
            </span>
            <Slider
              disabled={disabled}
              defaultValue={[value]}
              value={[sliderValue]}
              min={min}
              max={max}
              step={step}
              onValueChange={(e) => {
                setValue(e[0])
              }}
              onValueCommit={(e) => {
                if (onChangeValue) onChangeValue(e[0])
              }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side={isLg ? "left" : "bottom"}>
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export default ParamaterSlider
