# openplayground

An LLM playground you can run on your laptop.

https://user-images.githubusercontent.com/111631/227399583-39b23f48-9823-4571-a906-985dbe282b20.mp4

#### Features

- Use any model from [OpenAI](), [Anthropic](), [Cohere](), [Forefront](), [HuggingFace](), [Aleph Alpha](), and [llama.cpp]().
- Full playground UI, including history, parameter tuning, keyboard shortcuts, and logprops.
- Compare models side-by-side with the same prompt, individually tune model parameters, and retry with different parameters.
- Automatically detects local models in your HuggingFace cache, and lets you install new ones.
- Works OK on your phone.
- Probably won't kill everyone.

## Try on nat.dev

Try the hosted version: [nat.dev](https://nat.dev).

## How to install and run

```sh
$ pip install openplayground
$ openplayground run
```

Alternatively, run it as a docker container:
```sh
$ docker run --name openplayground -p 5432:5432 -d --volume openplayground:/web/config natorg/openplayground
```

This runs a Flask process, so you can add the typical flags such as setting a different port `openplayground run -p 1235` and others.

## How to run for development

```sh
$ git clone https://github.com/nat/openplayground
$ cd app && npm install && npx parcel watch src/index.html --no-cache
$ cd server && pip3 install -r requirements.txt && cd .. && python3 -m server.app -m ./server/models.json
```

## Docker

```sh
$ docker build . --tag "openplayground"
$ docker run --name openplayground -p 5432:5432 -d --volume openplayground:/web/config openplayground
```

First volume is optional. It's used to store API keys, models settings.

## Ideas for contributions

- Add a token counter to the playground
- Add a cost counter to the playground and the compare page
- Measure and display time to first token
- Setup automatic builds with GitHub Actions
- The default parameters for each model are configured in the `server/models.json` file. If you find better default parameters for a model, please submit a pull request!
- Someone can help us make a homebrew package, and a dockerfile
- Easier way to install open source models directly from openplayground, with `openplayground install <model>` or in the UI.
- Find and fix bugs
- ChatGPT UI, with turn-by-turn, markdown rendering, chatgpt plugin support, etc.
- We will probably need multimodal inputs and outputs at some point in 2023

### llama.cpp

## Adding models to openplayground

Models and providers have three types in openplayground:

- Searchable
- Local inference
- API

You can add models in `server/models.json` with the following schema:

#### Local inference

For models running locally on your device you can add llama-cpp-python dependency and set **LLAMA-7B_MODEL_BIN_PATH** and **LLAMA-7B_MODEL_PROMPT_PATH** variable in .env file. the **LLAMA-7B** part should match the name in models.json. 

The LLAMA-7B_MODEL_PROMPT_PATH file should match the model prompt format. Here is some example:

##### Llama

```
Transcript of a dialog, where the User interacts with an Assistant named Bob. Bob is helpful, kind, honest, good at writing, and never fails to answer the User's requests immediately and with precision.

User: Hello, Bob.
Bob: Hello. How may I help you today?
User: Please tell me the largest city in Europe.
Bob: Sure. The largest city in Europe is Moscow, the capital of Russia.
User:{prompt}
Bob:
```

##### Alpaca

```
### Instruction:
{prompt}

### Response:

```

##### Vicuna

```
### Human:{prompt}
### Assistant:
```


Keep in mind you will need to add a generation method for your model in `server/app.py`. Take a look at `local_text_generation_llama()` as an example.

#### API Provider Inference

This is for model providers like OpenAI, cohere, forefront, and more. You can connect them easily into openplayground (a minimal example):

```json
"cohere": {
    "api_key" : true,
    "models" : {
        "xlarge": {
            "parameters": {
                "temperature": {
                    "value": 0.5,
                    "range": [
                        0.1,
                        1.0
                    ]
                },
            }
        }
    }
}
```

Keep in mind you will need to add a generation method for your model in `server/app.py`. Take a look at `openai_text_generation()` or `cohere_text_generation()` as an example.

#### Searchable models

We use this for Huggingface Remote Inference models, the search endpoint is useful for scaling to N models in the settings page.

```json
"provider_name": {
    "api_key": true,
    "search": {
        "endpoint": "ENDPOINT_URL"
    },
    "parameters": {
        "parameter": {
            "value": 1.0,
            "range": [
                0.1,
                1.0
            ]
        },
    }
}
```

#### Credits

Instigated by Nat Friedman. Initial implementation by [Zain Huda](https://github.com/zainhuda) as a repl.it bounty. Many features and extensive refactoring by Alex Lourenco.
