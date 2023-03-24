# openplayground

An LLM playground you can run on your laptop.

https://user-images.githubusercontent.com/111631/227391395-906c7383-1879-4e69-a38f-d8a15dc4305c.mp4

https://user-images.githubusercontent.com/111631/227391395-906c7383-1879-4e69-a38f-d8a15dc4305c.mp4

#### Features

- Use any model from OpenAI, Anthropic, Cohere, Forefront, HuggingFace, Aleph Alpha, llama.cpp
- Full playground UI, including history, parameter tuning, keyboard shortcuts, logprops
- Compare screen where you run run test models against the same prompt simultaneously, individually tune model parameters, the try same model multiple times with different paramaters
- Automatically detects local models in your HuggingFace cache, lets you install new ones
- Works ok on phone
- Probably won't kill everyone

## Try on nat.dev

Try the free hosted version: [nat.dev](https://nat.dev).

## How to install and run

```
% pip install openplayground
% openplayground run
```

## How to run for development
```
% git clone https://github.com/nat/openplayground
% cd app && npx parcel watch src/index.html --no-cache
% cd server && flask run --debug -p $PORT
```

## Ideas for contributions

- Add tests 😅
- Setup automatic builds with GitHub Actions
- The default parameters for each model are configured in the `server/models.json` file. If you find better default parameters for a model, please submit a pull request!
- Someone can help us make a homebrew package, and a dockerfile
- Easier way to install open source models directly from openplayground, with `openplayground install <model>` or in the UI.
- Find and fix bugs
- ChatGPT UI, with turn-by-turn, markdown rendering, chatgpt plugin support, etc.
- We will probably need multimodal inputs and outputs at some point in 2023

### llama.cpp

## Credits

