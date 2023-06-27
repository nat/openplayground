import React, { useContext } from "react"
import { Button } from "../../components/ui/button"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { X } from "lucide-react"
import {HistoryContext} from "../../app"
import { useHotkeys } from 'react-hotkeys-hook'


export default function HistorySidePanel() {
  const {
    historyContext, toggleShowHistory, clearHistory, selectHistoryItem
  } = useContext(HistoryContext);

  const hotkeyOptions = {preventDefault: true, enableOnFormTags: true}
  useHotkeys("meta+h", () => toggleShowHistory(), hotkeyOptions)

  const handleDeleteAllHistory = () => {
    clearHistory()
  }

  if (!historyContext.show) return null;

  const downloadHistory = () => {
    const element = document.createElement("a")
    const history_json = historyContext.entries.map((entry: any) => {
      const model = entry.modelsState.find(({selected}) => selected)
      const text = EditorState.createWithContent(convertFromRaw(entry.editor.internalState)).getCurrentContent().getPlainText()
      return {
        model: model.name,
        date: entry.date,
        timestamp: entry.timestamp,
        text: text,
        parameters: entry.parameters
      }
    })

    const file = new Blob([JSON.stringify(history_json)], {
      type: "application/json",
    })
    element.href = URL.createObjectURL(file)
    element.download = "history.json"
    document.body.appendChild(element) // Required for this to work in FireFox
    element.click()
  }
  return (
      <div className="flex flex-col h-full relative overflow-auto">
        <div
          className="text-lg tracking-tight font-semibold text-slate-900 flex sticky top-[0] right-[0]"
          style={{ justifyContent: "flex-end" }}
        >
          <div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                type="button"
                variant="subtle"
                className="inline-flex text-sm font-medium outline-0"
                onClick={(e) => {
                  setShowHistory((e) => !e)
                }}
                disabled={history.length == 0}
              >
                ...
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="outline-0 cursor-default min-w-[150px] bg-white rounded-md shadow-[0px_10px_38px_-10px_rgba(22,_23,_24,_0.35),_0px_10px_20px_-15px_rgba(22,_23,_24,_0.2)] will-change-[opacity,transform] data-[side=top]:animate-slideDownAndFade data-[side=right]:animate-slideLeftAndFade data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade z-10"
                sideOffset={5}
              >
                <DropdownMenu.Item
                  className="cursor-pointer outline-0 hover:bg-slate-200 text-sm p-2 text-center"
                  onClick={() => {
                    downloadHistory()
                  }}
                  >
                  Download as JSON
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-[1px] bg-slate-200" />
                <DropdownMenu.Item
                  className="cursor-pointer outline-0 hover:bg-slate-200 text-sm p-2 text-center"
                  onClick={() => {
                    handleDeleteAllHistory()
                  }}
                >
                  Clear History
                </DropdownMenu.Item>
                <DropdownMenu.Arrow className="fill-white" />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="cursor-pointer inline m-2 align-middle lg:inline align-middle mb-1" style = {{height: 20, width: 20}}>
            <X
              size={20}
              onClick={(e) => {
                toggleShowHistory()
              }}
            />
          </div>
        </div>

        <div className="overflow-y-auto max-h-[100%] mt-2">
          {historyContext.entries
              .reduce((accumulator: any, value: any) => {
                let val = value.date
                if (!accumulator.includes(val)) {
                  accumulator.push(val)
                }
                return accumulator.sort((a, b) => (new Date(b) - new Date(a)))
              }, [])
              .map((unique_date: any, main_index) => {

                return (
                  <div key = {unique_date}>
                    <div className="text-xs tracking-tight mb-4 mt-2 font-semibold uppercase text-slate-900">
                      {new Date(unique_date).toLocaleDateString(
                        ["en-GB", "en-us"],
                        {
                          weekday: "long",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }
                      )}
                    </div>
                    {historyContext.entries
                      .filter((value: any) => (value.date === unique_date))
                      .sort((a: any, b: any) => (new Date(b.timestamp) - new Date(a.timestamp)))
                      .map((historyItem: any, index: number) => {
                        const isSelectedHistoryItem = historyContext?.current?.timestamp === historyItem.timestamp && historyContext?.current?.editor.prompt === historyItem.editor.prompt;

                        return (
                          <div key={historyItem.timestamp}>
                            <div
                              onClick={() => {
                                selectHistoryItem(historyItem)
                              }}
                              className={`[&>div:nth-child(2)]:hover:w-[7px]
                              [&>div:nth-child(2)]:hover:h-[7px]
                              [&>div:nth-child(2)]:hover:left-[77px]
                              [&>div:nth-child(2)]:hover:border-slate-800
                              [&>div:nth-child(2)]:hover:border-2
                              rounded-sm rounded-sm relative flex flex-row p-4 font-bold text-sm cursor-pointer click:bg-slate-300 dark:hover:bg-slate-200  ${
                                isSelectedHistoryItem
                                  ? "bg-slate-200"
                                  : "hover:bg-slate-100"
                              }`}
                            >
                              <div
                                className={`bg-slate-300 w-[1px] absolute left-[80px] ${
                                  main_index === 0 && index === 0
                                    ? "h-[75%] top-[25%]"
                                    : "h-[100%] top-[0]"
                                }`}
                              />
                              <div
                                className={`ease-in duration-100 border rounded-full bg-white absolute top-[22px] ${
                                  isSelectedHistoryItem
                                    ? "border-slate-800 w-[7px] h-[7px] border-2 left-[77px]"
                                    : "border-slate-500 w-[5px] h-[5px] left-[78px] "
                                }
                              `}
                              />
                              <div className="text-xs pl-4 pr-10">
                                {main_index === 0 && index === 0 ? (
                                  <span style = {{marginRight: 6}}>Now</span>
                                ) : (
                                  new Date(historyItem.timestamp)
                                    .toTimeString()
                                    .split(":")
                                    .slice(0, 2)
                                    .join(":")
                                )}
                              </div>
                              <div className="text-xs overflow-hidden ">
                                <p className="truncate tracking-wide">
                                  {main_index === 0 && index === 0
                                    ? "Current"
                                    : historyItem.editor.prompt}
                                </p>
                                <div
                                  className="mt font-medium"
                                  style={{
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                  }}
                                >
                                  {historyItem.modelsState.find(({selected})=> selected).name}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )
              })}
        </div>
      </div>
  )
}
