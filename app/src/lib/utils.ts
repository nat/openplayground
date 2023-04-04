import { ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function handleSelectModel(modelState, modelsStateContext, setModelsStateContext, parametersContext, setParametersContext, multi_select: boolean) {
  const number_of_models_selected = modelsStateContext.filter(modelState => modelState.selected).length
  const selected = (!multi_select && number_of_models_selected > 1) ? true : !modelState.selected

  if (selected && !multi_select) {
    const parameters = modelState.parameters

    setParametersContext({
      ...parametersContext,
      temperature: parameters.temperature?.value || parametersContext.temperature,
      maximumLength: parameters.maximumLength?.value || parametersContext.maximumLength,
      topP: parameters.topP?.value || parametersContext.topP,
      topK: parameters.topK?.value || parametersContext.topK,
      frequencyPenalty: parameters.frequencyPenalty?.value || parametersContext.frequencyPenalty,
      presencePenalty: parameters.presencePenalty?.value || parametersContext.presencePenalty,
      repetitionPenalty: parameters.repetitionPenalty?.value || parametersContext.repetitionPenalty,
      stopSequences: parameters.stopSequences?.value || parametersContext.stopSequences
    })
  }

  setModelsStateContext(
    modelsStateContext.map((m) => {
      if (!multi_select && m.tag !== modelState.tag) {
        m.selected = false
      } else if (m.tag === modelState.tag) {
        m.selected = selected
      }
      return m
    })
  )
}