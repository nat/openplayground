## Running latest build
```
cd server
flask --app app --debug run
```
## Problem Description
The goal is to create a web UI like the OpenAI playground that can be used to test your own models (e.g. a T5 finetune). This would require having all the nice UI features of the OpenAI playground, including:

+ text streaming [DONE]
+ support for all keyboard shortcuts 
+ model selection [DONE] 
+ generation parameter selection (temp, max length, etc). [DONE]
+ stop sequence, start text, restart text [DONE]
+ the ability to show probabilities [DONE]
+ green text that behaves like the OpenAI green text [DONE]
+ undo / regenerate buttons [DONE]
+ saving/loading presets [DONE]

## Acceptance Criteria
In your application please explain how you would implement this. Applications with basic prototypes or partial implementations will be given priority.

Your solution should be written in Python (since the people using this are mostly Pythonistas). I should be able to easily run this and launch a web UI where I can select a model from HuggingFace, and have a UI experience that's hard to distinguish from the OpenAI playground.

At minimum you should be able to load models locally. For extra credit, consider adding support for remotely inferencing models on huggingface, modal, replicate, cohere, etc.
