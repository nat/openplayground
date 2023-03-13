import React, { useContext, useEffect, useState } from "react"
import NavBar from "../components/navbar"
import { Button } from "../components/ui/button"
import { Separator } from "../components/ui/separator"
import { useBreakpoint } from "../hooks/useBreakpoint"

const tags = ["OpenAI", "co:here", "Anthropic", "HuggingFace", "Forefront"]

const models_info = [
        { 
            "model_name" : "gpt-3.5-turbo", 
            "provider": "OpenAI", 
            "notes": "Model is optimized for chat",
            "params": "175B",
            "tokens": "N/A", 
            "finetuning" : "No",
            "training_cost" : "Unknown"
        },
        { 
            "model_name" : "text-davinci-003", 
            "provider": "OpenAI", 
            "notes": "N/A",
            "params": "175B",
            "tokens": "N/A", 
            "finetuning" : "No",
            "training_cost" : "~5M"
        },
        { 
            "model_name" : "text-davinci-002", 
            "provider": "OpenAI", 
            "notes": "N/A",
            "params": "175B",
            "tokens": "N/A", 
            "finetuning" : "No",
            "training_cost" : "~5M"
        },
        { 
            "model_name" : "text-curie-001", 
            "provider": "OpenAI", 
            "notes": "N/A",
            "params": "6.7B",
            "tokens": "N/A", 
            "finetuning" : "No",
            "training_cost" : "~5M"
        },
        { 
            "model_name" : "text-babbage-001", 
            "provider": "OpenAI", 
            "notes": "N/A",
            "params": "1B",
            "tokens": "N/A", 
            "finetuning" : "No",
            "training_cost" : "~5M"
        },
        { 
            "model_name" : "Claude", 
            "provider": "Anthropic", 
            "notes": "Conversational agent",
            "params": "52B",
            "tokens": "N/A", 
            "finetuning" : "No",
            "training_cost" : "~5M"
        }

    ]
//             ["text-davinci-003", "Can do any language task with better quality, longer output, and consistent instruction-following than the curie, babbage, or ada models. Also supports inserting completions within text.  Training Data: Up to Jun 2021."],
//         ["text-davinci-002", "Similar capabilities to text-davinci-003 but trained with supervised fine-tuning instead of reinforcement learning. Training Data: Up to Jun 2021."],
//         ["text-ada-001", "Capable of very simple tasks, usually the fastest model in the GPT-3 series, and lowest cost. Training Data: Up to Oct 2019."],
//         ["text-babbage-001", "Capable of straightforward tasks, very fast, and lower cost. Training Data: Up to Oct 2019."], 
//         ["text-curie-001", "Very capable, faster and lower cost than Davinci. Training Data: Up to Oct 2019."],
//     ],
//     "co:here": [
//         ["command-nightly", "Command is a generative model that responds well with instruction-like prompts, and is available in two sizes: medium and xlarge. The xlarge model demonstrates better performance, and medium is a great option for developers who require fast response, like those building chatbots. Cohere offers the nightly versions of command which are improved every week, so you can expect the performance of command-nightly to improve on a regular cadence."],
//         ["medium and base", "These are base models that Cohere provides for text generation. They can be used for interactive autocomplete, augmenting human writing processes, summarization, text rephrasing, and other text-to-text tasks in non-sensitive domains."]
//     ],
//     "Anthropic": [
//         ["Claude", "Claude is a large language model (LLM) built by Anthropic. It's trained to be a helpful assistant in a conversational tone."],
//     ],
//     "HuggingFace": [
//         ["bigscience/bloomz", "BLOOMZ is a family of models capable of following human instructions in dozens of languages zero-shot. It is a fintuned BLOOM & mT5 pretrained multilingual language model on crosslingual task mixture (xP3) resulting in models capable of crosslingual generalization to unseen tasks & languages."],
//         ["google/flan-t5-xxl", "flan-t5-xxl is 11B parameter T5 model fine-tuned on more than on more than 1000 additional tasks covering also more languages. These models achieve strong few-shot performance even compared to much larger models, such as PaLM 62B."],
//         ["google/flan-ul2", "Flan-UL2 20B is an encoder decoder model based on the T5 architecture. It uses as the UL2 model released earlier last year. It was fine tuned using the Flan prompt tuning and dataset collection. Important thing to note is that Flan-UL2 checkpoint uses a receptive field of 2048 which makes it more usable for few-shot in-context learning compared to the original UL2 model was only trained with receptive field of 512, which made it non-ideal for N-shot prompting where N is large."]
//     ],
//     "Forefront": [
//         ["codegen-16b", "CodeGen is an open-source model for program synthesis, competitive with OpenAI Codex. We provide two versions: multi and nl. nl models are randomly initialized and trained on The Pile, a 825.18 GB English text corpus. multi models are initialized from nl models and then trained on a corpus with code data consisting of multiple programming languages."],
//         ["pythia", "Pythia is EleutherAI's open source language model, we provide all three versions: 6.9B, 12B, and 20B."],
//         ["gpt-neox-20b-vanilla", "GPT-NeoX is EluetherAI's 20B open source language model trained on Pile dataset. GPT-NeoX-20B is a particularly powerful few-shot reasoner and gains far more in performance when evaluated five-shot than similarly sized GPT-3 and FairSeq models. GPT-NeoX-20B also has a different tokenizer from the one used in GPT-J-6B and GPT-Neo. The new tokenizer allocates additional tokens to whitespace characters, making the model more suitable for certain tasks like code generation."],
//         ["gpt-j-6b-vanilla", "GPT-J is EluetherAI's 6B open source language model. It is a GPT-2-like causal language model trained on the Pile dataset."],
//     ]
// }

        

export default function About() {
    const [modelProvider, setModelProvider] = useState("")
    const { isLg } = useBreakpoint("lg")

    return (
    <div className="flex flex-col h-full">
      <NavBar tab="about"/>
      <div className="flex flex-col font-display flex-grow">
        <div className="lg:flex-grow grid gap-2 grid-cols-6 mx-1 lg:mx-5 flex flex-row">
          {/* RENDER MODEL BASED PAGE HERE */}
          <div className="col-span-6 lg:col-span-6 flex flex-row mx-2 lg:mx-0">
            <div className="">
                <h1 className="scroll-m-20 text-2xl font-medium tracking-tight">
                    Thanks for using OpenPlayground!
                </h1>
                <ul className="mt-2">
                    <li>Instigated by Nat Friedman</li>
                    <li>Coded by Zain Huda and Alex Lourenco</li>
                    <li>Report bugs in our <a className="underline underline-offset-2" href="https://discord.gg/REgcyAfX" target="_blank">Discord</a></li>
                    <li>We'll open source this soon, so you can run the playground locally!</li>
                </ul>
                <h1 className="scroll-m-20 text-2xl font-medium tracking-tight mt-4">
                    Available Models
                </h1>
                <div className="mt-3">
                    <table className="border-collapse border-seperate table-auto w-screen">
                        <thead>
                            <tr className="text-lg">
                            <th>Model Name</th>
                            <th>Created By</th>
                            <th>Notes</th>
                            <th>Params</th>
                            <th>Tokens</th>
                            <th>Fine Tuning</th>
                            <th>Training Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            
                            {models_info.map((model_info: any) => 
                                <tr className="text-center odd:bg-white even:bg-slate-100">
                                    <td>{model_info.model_name}</td>
                                    <td>{model_info.provider}</td>
                                    <td>{model_info.notes}</td>
                                    <td>{model_info.params}</td>
                                    <td>{model_info.tokens}</td>
                                    <td>{model_info.finetuning}</td>
                                    <td>{model_info.training_cost}</td>
                                </tr>
                                )
                            }
                        </tbody>
                    </table>
                </div>

                
                {/* <>
                    <h1 className="scroll-m-20 text-2xl font-medium tracking-tight">
                        {modelProvider} Models
                    </h1>
                    <h3 className="scroll-m-20 text-xl font-medium tracking-tight mt-2">
                        These are the current models available in OpenPlayground from {modelProvider}.
                    </h3>
                    {models_info[modelProvider].map((model: any) => (
                        <div className="flex flex-col mt-5">
                            <h1 className="scroll-m-20 text-xl font-medium tracking-tight">
                                {model[0]}
                            </h1>
                            <h3 className="scroll-m-20 text-medium font-base tracking-tight mt-2">
                                {model[1]}
                            </h3>
                        </div>
                    ))}
                </>
                } */}
            </div>
          </div>
        </div>
      </div>
    </div>
    )
}

