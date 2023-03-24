import anthropic
import cachetools
import click
import importlib.resources as pkg_resources
import json
import math
import openai
import os
import requests
import sseclient
import threading
import time
import traceback
import urllib
import warnings
import sentencepiece as spm

from .inference.huggingface.hf import HFInference
from .sse import Message
from .sseserver import SSEQueue

from aleph_alpha_client import Client as aleph_client, CompletionRequest, Prompt
from datetime import datetime
from dataclasses import dataclass
from dotenv import load_dotenv, set_key
from typing import Callable, List, Union
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, Response, send_from_directory, stream_with_context
from flask.cli import FlaskGroup
from flask_cors import CORS
from huggingface_hub import hf_hub_download, try_to_load_from_cache, scan_cache_dir, _CACHED_NO_EXIST
from transformers import T5Tokenizer

google_tokenizer = T5Tokenizer.from_pretrained("google/flan-t5-xl")

# Monkey patching for warnings, for convenience
def warning_on_one_line(message, category, filename, lineno, file=None, line=None):
    return '%s:%s: %s: %s\n' % (filename, lineno, category.__name__, message)

warnings.formatwarning = warning_on_one_line

# global variables
DOTENV_FILE_PATH = None
MODELS_JSON = None
SSE_MANAGER = SSEQueue()

def write_to_env(key: str, value: str) -> None:
    '''
    Writes a key-value pair to the .env file
    '''
    global DOTENV_FILE_PATH
    if not os.path.exists(DOTENV_FILE_PATH):
        open(DOTENV_FILE_PATH, 'a').close()

    set_key(DOTENV_FILE_PATH, key, value)

app = Flask(__name__, static_folder='../app/dist')

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path == "" or not os.path.exists(app.static_folder + '/' + path):
        path = 'index.html'

    return send_from_directory(app.static_folder, path)

def create_response_message(message: str, status_code: int) -> Response:
    response = jsonify({'status': message})
    response.status_code = status_code
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route("/api/stream", methods=["POST"])
def stream_inference():
    '''
    Takes in inference request from frontend, checks for valid parameters, and dispatchees to inference queue
    '''
    data = request.get_json(force=True)
    print(f"Path: {request.path}, Request: {data}")

    if not isinstance(data['prompt'], str) or not isinstance(data['models'], list):
        return create_response_message("Invalid request", 400)
    
    request_uuid = "1"

    prompt = data['prompt']
    models = data['models']
    providers = MODELS_JSON.keys()

    all_tasks = []
    models_name_provider = []

    for model in models:
        name = model['name']
        provider = model['provider']
        tag = model['tag']
        parameters = model['parameters']

        if not isinstance(name, str) or not isinstance(tag, str) or not isinstance(parameters, dict):
            continue
        
        if provider not in providers:
            continue
        
        models_name_provider.append({"name": model['name'], "provider": model['provider']})

        required_parameters = []
        sanitized_params = {}
        if provider == "openai":
            name = name.removeprefix("openai:")
            required_parameters = ["temperature", "topP", "maximumLength", "stopSequences", "frequencyPenalty", "presencePenalty", "stopSequences"]
        elif provider == "cohere":
            name = name.removeprefix("cohere:")
            required_parameters = ["temperature", "topP", "topK", "maximumLength", "presencePenalty", "frequencyPenalty", "stopSequences"]
        elif provider == "huggingface":
            name = name.removeprefix("huggingface:")
            required_parameters = ["temperature", "topP", "topK", "repetitionPenalty", "maximumLength", "stopSequences"]
        elif provider == "forefront":
            name = name.removeprefix("forefront:")
            required_parameters = ["temperature", "topP", "topK", "repetitionPenalty", "maximumLength", "stopSequences"]
        elif provider == "textgeneration":
            name = name.removeprefix("textgeneration:")
            required_parameters = ["temperature", "topP",  "topK", "repetitionPenalty", "maximumLength"]
        elif provider == "anthropic":
            name = name.removeprefix("anthropic:")
            required_parameters = ["temperature", "topP",  "topK", "maximumLength", "stopSequences"]
        elif provider == "aleph-alpha":
            name = name.removeprefix("aleph-alpha:")
            required_parameters = ["temperature", "topP",  "topK", "maximumLength", "repetitionPenalty", "stopSequences"]
        else:
            raise ValueError(f"Invalid provider: {provider}, please define a valid parameters for this provider")

        for param in required_parameters:
            if param not in parameters:
                return create_response_message(f"Missing required parameter: {name} - {provider} - {param}", 400)

            if param == "stopSequences":
                if parameters[param] is None:
                    parameters[param] = []
                if (not isinstance(parameters[param], list) and not parameters[param] == None):
                    return create_response_message(f"Invalid stopSequences parameter", 400)
            elif not isinstance(parameters[param], (int, float)) and not (isinstance(parameters[param], str) and parameters[param].replace('.', '').isdigit()):
                return create_response_message(f"Invalid parameter: {param} - {name}", 400)
            
            sanitized_params[param] = parameters[param]

        all_tasks.append(InferenceRequest(
            uuid=request_uuid, model_name=name, model_tag=tag, model_provider=provider,
            model_parameters=sanitized_params, prompt=prompt)
        )
    
    global SSE_MANAGER
    uuid = "1"
    print("Streaming SSE", uuid)

    if len(all_tasks) == 0:
        return create_response_message("Invalid Request", 400)
    
    thread = threading.Thread(target=bulk_completions, args=(all_tasks,))
    thread.start()

    @stream_with_context
    def generator():
        messages = SSE_MANAGER.listen()
        try:
            while True:
                message = messages.get()
                message = json.loads(message)
                if message["type"] == "done":
                    print("Done streaming SSE")
                    break
                print("YIELDING message", str(Message(**message)))
                yield str(Message(**message))
        except GeneratorExit:
            print("SSE Terminated")
            SSE_MANAGER.announce(message=json.dumps({"uuid": uuid}))
            print("GeneratorExit")

    return Response(stream_with_context(generator()), mimetype='text/event-stream')

@app.route('/api/all_models', methods=['GET'])
def all_models():
    providers = MODELS_JSON.keys()
    models_by_provider = {}
    for provider in providers:
        models_by_provider[provider] = []

    models = GlobalState.model_manager.get_all_models_with_parameters()

    for model_tag in models:
        model = models[model_tag]
        models_by_provider[model['provider']].append((model_tag, model))

    sorted_models = {}
    
    # add stuff for models we don't have set 
    for provider in providers:
        for model_tag, model in models_by_provider[provider]:
            model_tag = f"{provider}:{model_tag}"
            sorted_models[model_tag] = model

    response = app.response_class(
        response=json.dumps(sorted_models),
        status=200,
        mimetype='application/json'
    )

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/providers', methods=['GET'])
def providers():
    '''
    Returns providers that do not have models defined (HF remote, local inference models).
    These are defined as providers with no model tag but parameters tag instead.
    Optionally, for remote inference providers, a search endpoint can be defined as well for getting model information.
    Parameter defaults and ranges set for these providers will be respected for all models from that provider.
    For locally inferenced models, only parameters need to be defined.

    Returns:
        Response: json object with providers and their information
    
    Example:
        {
            "huggingface": {
                "search": {
                    "url": "https://huggingface.co/models"
                },
                "parameters": {
                    "temperature": {
                        "default": 0.7,
                        "range": [0.0, 1.0]
                    },
            },
            "llama": {
                "parameters": {
                    "temperature": {
                        "default": 0.7,
                        "range": [0.0, 1.0]
                    },
                }
            }
        }
    '''
    providers = MODELS_JSON.keys()
    info_by_provider = {}

    for provider in providers:
        if "models" not in MODELS_JSON[provider]:
            info_by_provider[provider] = MODELS_JSON[provider]

    response = app.response_class(
        response=json.dumps(info_by_provider),
        status=200,
        mimetype='application/json'
    )

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/store-api-key', methods=['POST'])
def store_api_key():
    '''
    Routes to store, reload, and check API keys
    Store API key in .env file, for given provider
    '''
    data = request.get_json(force=True)
    print(data)
    model_provider = data['model_provider'].upper()
    model_provider_value = data['api_key']
    provider_key = model_provider + "_API_KEY"
    
    write_to_env(provider_key, model_provider_value)
    load_dotenv(DOTENV_FILE_PATH, override=True) # reload .env file

    response = jsonify({'status': 'success'})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/check-key-store', methods=['GET'])
def check_key_store():
    '''
    Checks all the API keys stored in the .env file - matches against the providers in models.json
    Model must have "api_key" field set to true in models.json, otherwise "None" is returned
    Keys are stored in .env in {PROVIDER}_API_KEY format
    '''
    response = {}
    for provider in MODELS_JSON.keys():
        if (provider == "default"): 
            continue
        else:
            provider_key = provider.upper() + "_API_KEY"

        if MODELS_JSON[provider]["api_key"] == False:
            warnings.warn("warning: no API key needed for provider " + provider)
            response[provider] = "None"
        elif os.environ.get(provider_key) is None:
            warnings.warn("warning: no API key found for provider " + provider)
            response[provider] = ""
        else:
            response[provider] = os.environ.get(provider_key)

    response = jsonify(response)
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/download-model', methods=['POST'])
def request_model_download():
    '''
    Downloads model from huggingface, in background. 
    If model already exists in cache, returns "already downloaded"

    Returns:
        Response: json object with status of download
    '''
    data = request.get_json(force=True)
    print(data)
    model_name = data['model_name'].removeprefix("textgeneration:")
    filepath = try_to_load_from_cache(model_name, filename="pytorch_model.bin")
    if isinstance(filepath, str):
        response = jsonify({'status': 'already downloaded'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    else:
        download_model(model_name)
        response = jsonify({'status': 'success'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

@app.route('/api/model-in-cache', methods=['GET'])
def check_model_in_cache():
    '''
    Check if model exists in huggingface cache, downloadi n background if requested
    '''
    data = request.args.get('model')
    print(data)
    model_name = data.removeprefix("textgeneration:")
    filepath = try_to_load_from_cache(model_name, filename="pytorch_model.bin")
    if isinstance(filepath, str):
        response = jsonify({'status': 'success'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    elif filepath is _CACHED_NO_EXIST:
        response = jsonify({'status': 'failure'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

@app.route('/api/get-models-in-cache', methods=['GET'])
def get_models_in_cache():
    '''
    Get all models in huggingface cache

    Returns:
        Response: json object with list of models in cache

    Throws:
        Exception: if download fails
    '''
    models = []
    cache_list = scan_cache_dir()
    for r in cache_list.repos:
        if r.repo_type == "model":
            models.append(r.repo_id)
    response = jsonify({'models': models})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

def download_model(model_name: str):
    print("Downloading model")
    try:
        hf_hub_download(repo_id=model_name, filename="pytorch_model.bin") # do we need to add cache dir?
    except Exception as e:
        print("Error occured")
        print(e)
    print("Model downloaded")
    return True

CORS(app)

@dataclass
class ProviderDetails:
    '''
    Args:
        api_key (str): API key for provider
        version_key (str): version key for provider
    '''
    api_key: str
    version_key: str

@dataclass
class InferenceRequest:
    '''
    Args:
        uuid (str): unique identifier for inference request
        model_name (str): name of model to use
        model_tag (str): tag of model to use
        model_provider (str): provider of model to use
        model_parameters (dict): parameters for model
        prompt (str): prompt to use for inference
    '''
    uuid: str
    model_name: str
    model_tag: str
    model_provider: str
    model_parameters: dict
    prompt: str

@dataclass
class ProablityDistribution:
    '''
    Args:
        log_prob_sum (float): sum of log probabilities
        simple_prob_sum (float): sum of simple probabilities
        tokens (dict): dictionary of tokens and their probabilities
    '''
    log_prob_sum: float
    simple_prob_sum: float
    tokens: dict

@dataclass
class InferenceResult:
    '''
    Args:
        uuid (str): unique identifier for inference request
        model_name (str): name of model to use
        model_tag (str): tag of model to use
        model_provider (str): provider of model to use
        token (str): token returned by inference
        probability (float): probability of token
        top_n_distribution (ProablityDistribution): top n distribution of tokens
    '''
    uuid: str
    model_name: str
    model_tag: str
    model_provider: str
    token: str
    probability: Union[float, None]
    top_n_distribution: Union[ProablityDistribution, None]

InferenceFunction = Callable[[str, InferenceRequest], None]

class InferenceAnnouncer:
    def __init__(self, sse_client):
        self.sse_client = sse_client
        self.cancel_cache = cachetools.TTLCache(maxsize=1000, ttl=60)

    def __format_message__(self, event: str, infer_result: InferenceResult) -> str:
        print("formatting message")
        encoded = {
            "message": infer_result.token,
            "modelName": infer_result.model_name,
            "modelTag": infer_result.model_tag,
            "modelProvider": infer_result.model_provider,
        }

        if infer_result.probability is not None:
            encoded["prob"] = round(math.exp(infer_result.probability) * 100, 2) 

        if infer_result.top_n_distribution is not None:
            encoded["topDistribution"] = {
                "logProbSum": infer_result.top_n_distribution.log_prob_sum,
                "simpleProbSum": infer_result.top_n_distribution.simple_prob_sum,
                "tokens": infer_result.top_n_distribution.tokens
            }

        return json.dumps({"data": encoded, "type": event})
    
    def announce(self, infer_result: InferenceResult, event: str):
        if infer_result.uuid in self.cancel_cache:
            return False

        message = None
        if event == "done":
            message = json.dumps({"data": {}, "type": "done"})
        else:
            message = self.__format_message__(event=event, infer_result=infer_result)

        print(f"Announcing {event} for uuid: {infer_result.uuid}, message: {message}")
        self.sse_client.announce(message)

        return True

    def cancel_callback(self, message):
        if message['type'] == 'pmessage':
            data = json.loads(message['data'])
            uuid = data['uuid']
            print("\t\tCancelling inference for uuid: {}".format(uuid))
            self.cancel_cache[uuid] = True
        
   
class InferenceManager:
    def __init__(self, sse_client):
        self.announcer = InferenceAnnouncer(sse_client)

    def __error_handler__(self, inference_fn: InferenceFunction, provider_details: ProviderDetails, inference_request: InferenceRequest):
        infer_result = InferenceResult(
            uuid=inference_request.uuid,
            model_name=inference_request.model_name,
            model_tag=inference_request.model_tag,
            model_provider=inference_request.model_provider,
            token=None,
            probability=None,
            top_n_distribution=None
        )
    
        if not self.announcer.announce(InferenceResult(
            uuid=inference_request.uuid,
            model_name=inference_request.model_name,
            model_tag=inference_request.model_tag,
            model_provider=inference_request.model_provider,
            token="[INITIALIZING]",
            probability=None,
            top_n_distribution=None
        ), event="status"):
            return

        try:
            inference_fn(provider_details, inference_request)
        except openai.error.Timeout as e:
            infer_result.token = f"[ERROR] OpenAI API request timed out: {e}"
        except openai.error.APIError as e:
            infer_result.token = f"[ERROR] OpenAI API returned an API Error: {e}"
        except openai.error.APIConnectionError as e:
            infer_result.token = f"[ERROR] OpenAI API request failed to connect: {e}"
        except openai.error.InvalidRequestError as e:
            infer_result.token = f"[ERROR] OpenAI API request was invalid: {e}"
        except openai.error.AuthenticationError as e:
            infer_result.token = f"[ERROR] OpenAI API request was not authorized: {e}"
        except openai.error.PermissionError as e:
            infer_result.token = f"[ERROR] OpenAI API request was not permitted: {e}"
        except openai.error.RateLimitError as e:
            infer_result.token = f"[ERROR] OpenAI API request exceeded rate limit: {e}"
        except requests.exceptions.RequestException as e:
            print("RequestException: {}".format(e))
            if infer_result.model_provider == "huggingface":
                infer_result.token = f"[ERROR] No response from huggingface.co after sixty seconds"
            else:
                infer_result.token = f"[ERROR] No response from {infer_result.model_provider } after sixty seconds"
        except ValueError as e:
            if infer_result.model_provider == "textgeneration":
                infer_result.token = f"[ERROR] Error parsing response from local inference: {traceback.format_exc()}"
            else:
                infer_result.token = f"[ERROR] Error parsing response from API: {e}"
        except Exception as e:
            infer_result.token = f"[ERROR] {e}"
        finally:
            if infer_result.token is None:
                infer_result.token = "[COMPLETED]"
            self.announcer.announce(infer_result, event="status")
    
    def __openai_chat_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        openai.api_key = provider_details.api_key

        current_date = datetime.now().strftime("%Y-%m-%d")
        print("stop sequence", inference_request.model_parameters['stop_sequences'])
        response = openai.ChatCompletion.create(
             model=inference_request.model_name,
             messages = [
                {"role": "system", "content": "You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible. Knowledge cutoff: 2021-09-01 Current date: {current_date}"},
                {"role": "user", "content": inference_request.prompt},
            ],
            temperature=inference_request.model_parameters['temperature'],
            max_tokens=inference_request.model_parameters['maximumLength'],
            top_p=inference_request.model_parameters['topP'],
            frequency_penalty=inference_request.model_parameters['frequencyPenalty'],
            presence_penalty=inference_request.model_parameters['presencePenalty'],
            stream=True
        )

        cancelled = False

        for event in response:
            response = event['choices'][0]
            if response['finish_reason'] == "stop":
                break

            delta = response['delta']

            if not "content" in delta:
                continue
            generated_token = delta["content"]

            infer_response = InferenceResult(
                uuid=inference_request.uuid,
                model_name=inference_request.model_name,
                model_tag=inference_request.model_tag,
                model_provider=inference_request.model_provider,
                token=generated_token,
                probability=None,
                top_n_distribution=None
             )

            if cancelled: continue

            if not self.announcer.announce(infer_response, event="infer"):
                print("Cancelled inference")
                cancelled = True

    def __openai_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        openai.api_key = provider_details.api_key

        response = openai.Completion.create(
            model=inference_request.model_name,
            prompt=inference_request.prompt,
            temperature=inference_request.model_parameters['temperature'],
            max_tokens=inference_request.model_parameters['maximumLength'],
            top_p=inference_request.model_parameters['topP'],
            stop=None if len(inference_request.model_parameters['stopSequences']) == 0 else inference_request.model_parameters['stopSequences'],
            frequency_penalty=inference_request.model_parameters['frequencyPenalty'],
            presence_penalty=inference_request.model_parameters['presencePenalty'],
            logprobs=5,
            stream=True
        )
        cancelled = False

        for event in response:
            generated_token = event['choices'][0]['text']
            infer_response = None
            try:
                chosen_log_prob = 0
                likelihood = event['choices'][0]["logprobs"]['top_logprobs'][0]

                prob_dist = ProablityDistribution(
                    log_prob_sum=0, simple_prob_sum=0, tokens={},
                )

                for token, log_prob in likelihood.items():
                    simple_prob = round(math.exp(log_prob) * 100, 2)
                    prob_dist.tokens[token] = [log_prob, simple_prob]

                    if token == generated_token:
                        chosen_log_prob = round(log_prob, 2)
  
                    prob_dist.simple_prob_sum += simple_prob
                
                prob_dist.tokens = dict(
                    sorted(prob_dist.tokens.items(), key=lambda item: item[1][0], reverse=True)
                )
                prob_dist.log_prob_sum = chosen_log_prob
                prob_dist.simple_prob_sum = round(prob_dist.simple_prob_sum, 2)
             
                infer_response = InferenceResult(
                    uuid=inference_request.uuid,
                    model_name=inference_request.model_name,
                    model_tag=inference_request.model_tag,
                    model_provider=inference_request.model_provider,
                    token=generated_token,
                    probability=event['choices'][0]['logprobs']['token_logprobs'][0],
                    top_n_distribution=prob_dist
                )
            except IndexError:
                infer_response = InferenceResult(
                    uuid=inference_request.uuid,
                    model_name=inference_request.model_name,
                    model_tag=inference_request.model_tag,
                    model_provider=inference_request.model_provider,
                    token=generated_token,
                    probability=-1,
                    top_n_distribution=None
                )

            if cancelled: continue

            if not self.announcer.announce(infer_response, event="infer"):
                print("Cancelled inference")
                cancelled = True

    def openai_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        if inference_request.model_name == "gpt-3.5-turbo":
            self.__error_handler__(self.__openai_chat_generation__, provider_details, inference_request)
        else:
            self.__error_handler__(self.__openai_text_generation__, provider_details, inference_request)

    def __cohere_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        with requests.post("https://api.cohere.ai/generate",
            headers={
                "Authorization": f"Bearer {provider_details.api_key}",
                "Content-Type": "application/json",
                "Cohere-Version": "2021-11-08",
            },
            data=json.dumps({
                "prompt": inference_request.prompt,
                "model": inference_request.model_name,
                "temperature": float(inference_request.model_parameters['temperature']),
                "p": float(inference_request.model_parameters['topP']),
                "k": int(inference_request.model_parameters['topK']),
                "stopSequences": inference_request.model_parameters['stopSequences'],
                "frequencyPenalty": float(inference_request.model_parameters['frequencyPenalty']),
                "presencePenalty": float(inference_request.model_parameters['presencePenalty']),
                "return_likelihoods": "GENERATION",
                "max_tokens": int(inference_request.model_parameters['maximumLength']),
                "stream": True,
            }),
            stream=True
        ) as response:
            if response.status_code != 200:
                raise Exception(f"Request failed: {response.status_code} {response.reason}")

            cancelled = False

            for token in response.iter_lines():
                token = token.decode('utf-8')
                token_json = json.loads(token)
                if cancelled: continue

                if not self.announcer.announce(InferenceResult(
                    uuid=inference_request.uuid,
                    model_name=inference_request.model_name,
                    model_tag=inference_request.model_tag,
                    model_provider=inference_request.model_provider,
                    token=token_json['text'],
                    probability=None, #token_json['likelihood']
                    top_n_distribution=None
                ), event="infer"):
                    print("Cancelled inference")
                    cancelled = True

    def cohere_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__cohere_text_generation__, provider_details, inference_request)
    
    def __huggingface_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        print("[Loading HF Model]")
        print("HF API KEY", provider_details.api_key)
        response = requests.request("POST",
            f"https://api-inference.huggingface.co/models/{inference_request.model_name}",
            headers={"Authorization": f"Bearer {provider_details.api_key}"},
            json={
                "inputs": inference_request.prompt,
                "parameters": {
                    "max_length": min(inference_request.model_parameters['maximumLength'], 250), # max out at 250 tokens per request, we should handle for this in client side but just in case
                    "temperature": inference_request.model_parameters['temperature'],
                    "top_k": inference_request.model_parameters['topK'],
                    "top_p": inference_request.model_parameters['topP'],
                    "repetition_penalty": inference_request.model_parameters['repetitionPenalty'],
                    "stop_sequences": inference_request.model_parameters['stopSequences'],
                },
                "options": {
                    "use_cache": False
                }
            },
            timeout=60
        )

        content_type = response.headers["content-type"]
        total_tokens = 0
        cancelled = False

        if response.status_code != 200:
            raise Exception(f"Request failed: {response.status_code} {response.reason}")

        if content_type == "application/json":
            return_data = json.loads(response.content.decode("utf-8"))
            outputs = return_data[0]["generated_text"]
            outputs = outputs.removeprefix(inference_request.prompt)
            print("[Got HF Model output]")

            self.announcer.announce(InferenceResult(
                uuid=inference_request.uuid,
                model_name=inference_request.model_name,
                model_tag=inference_request.model_tag,
                model_provider=inference_request.model_provider,
                token=outputs,
                probability=None,
                top_n_distribution=None
            ), event="infer")
        else:
            previous_token_chars = None
            previous_token = None

            for response in response.iter_lines():
                response = response.decode('utf-8')
                if response == "":
                    continue

                response_json = json.loads(response[5:])
                if "error" in response:
                    error = response_json["error"]
                    raise Exception(f"{error}")

                token = response_json['token']
                
                total_tokens += 1
                
                if token["special"]:
                    continue
                
                if inference_request.model_name.startswith("google/flan-") and token['id'] != 3:

                    current_char = google_tokenizer.decode(token['id'])
                
                    if previous_token_chars is None:
                        previous_token_chars = current_char
                        previous_token = token['id']
                    else:
                        buffer_chars = google_tokenizer.decode([previous_token, token['id']])

                        if previous_token_chars != "\n":
                            previous_token_chars = previous_token_chars.lstrip()

                        previous_token_chars = buffer_chars.removeprefix(previous_token_chars)
                        previous_token = token['id']
                        response_json['token']['text'] = previous_token_chars

                if cancelled: continue

                if not self.announcer.announce(InferenceResult(
                    uuid=inference_request.uuid,
                    model_name=inference_request.model_name,
                    model_tag=inference_request.model_tag,
                    model_provider=inference_request.model_provider,
                    token= " " if token['id'] == 3 else response_json['token']['text'],
                    probability=response_json['token']['logprob'],
                    top_n_distribution=None
                ), event="infer"):
                    print("Cancelled inference")
                    cancelled = True
                    
        print("[Finished HF Model output]")
           
    def huggingface_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__huggingface_text_generation__, provider_details, inference_request)

    def __forefront_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        print("Forefront", inference_request.model_parameters, inference_request.model_name, provider_details.version_key)

        print(f'URL: {f"https://shared-api.forefront.link/organization/gPn2ZLSO3mTh/{inference_request.model_name}/completions/{provider_details.version_key}"}')
        with requests.post(
            f"https://shared-api.forefront.link/organization/gPn2ZLSO3mTh/{inference_request.model_name}/completions/{provider_details.version_key}",
            headers={
                "Authorization": f"Bearer {provider_details.api_key}",
                "Content-Type": "application/json",
            },
            data=json.dumps({
                "text": inference_request.prompt,
                "top_p": float(inference_request.model_parameters['topP']),
                "top_k": int(inference_request.model_parameters['topK']),
                "temperature":  float(inference_request.model_parameters['temperature']),
                "repetition_penalty":  float(inference_request.model_parameters['repetitionPenalty']),
                "length": int(inference_request.model_parameters['maximumLength']),
                "stop": inference_request.model_parameters['stopSequences'],
                "logprobs": 5,
                "stream": True,
            }),
            stream=True
        ) as response:
            print("response.status_code", response.status_code)
            if response.status_code != 200:
                raise Exception(f"Request failed: {response.status_code} {response.reason}")
            cancelled = False
            total_tokens = 0
            aggregate_string_length = 0

            for packet in sseclient.SSEClient(response).events():
                generated_token = None
                probability = None
                prob_dist = None

                if packet.event == "update":
                    packet.data = urllib.parse.unquote(packet.data)
                    generated_token = packet.data[aggregate_string_length:]
                    aggregate_string_length = len(packet.data)

                    if not self.announcer.announce(InferenceResult(
                        uuid=inference_request.uuid,
                        model_name=inference_request.model_name,
                        model_tag=inference_request.model_tag,
                        model_provider=inference_request.model_provider,
                        token=generated_token,
                        probability=probability,
                        top_n_distribution=prob_dist
                    ), event="infer"):
                        print("Cancelled inference")
                        cancelled = True
                elif packet.event == "message":
                    data = json.loads(packet.data)

                    logprobs = data["logprobs"][0]
                    tokens = logprobs["tokens"]
                    token_logprobs = logprobs["token_logprobs"]

                    new_tokens = tokens[total_tokens:]

                    for index, new_token in enumerate(new_tokens):
                        generated_token = new_token
            
                        probability = token_logprobs[total_tokens + index]
                        top_logprobs = logprobs["top_logprobs"][total_tokens + index]
                            
                        chosen_log_prob = 0
                        prob_dist = ProablityDistribution(
                            log_prob_sum=0, simple_prob_sum=0, tokens={},
                        )

                        for token, log_prob in top_logprobs.items():
                            if log_prob == -3000.0: continue
                            simple_prob = round(math.exp(log_prob) * 100, 2)
                            prob_dist.tokens[token] = [log_prob, simple_prob]

                            if token == new_token:
                                chosen_log_prob = round(log_prob, 2)
            
                            prob_dist.simple_prob_sum += simple_prob
                            
                        prob_dist.tokens = dict(
                            sorted(prob_dist.tokens.items(), key=lambda item: item[1][0], reverse=True)
                        )
                        prob_dist.log_prob_sum = chosen_log_prob
                        prob_dist.simple_prob_sum = round(prob_dist.simple_prob_sum, 2)

                        if not self.announcer.announce(InferenceResult(
                            uuid=inference_request.uuid,
                            model_name=inference_request.model_name,
                            model_tag=inference_request.model_tag,
                            model_provider=inference_request.model_provider,
                            token=generated_token,
                            probability=probability,
                            top_n_distribution=prob_dist
                        ), event="infer"):
                            print("Cancelled inference")
                            cancelled = True

                    total_tokens = len(tokens)
                elif packet.event == "end":
                    break
                else:
                    continue

                if cancelled: continue

    def forefront_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__forefront_text_generation__, provider_details, inference_request)

    def __local_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        cancelled = False

        hf = HFInference(inference_request.model_name)
        output = hf.generate(
            prompt=inference_request.prompt,
            max_length=int(inference_request.model_parameters['maximumLength']),
            top_p=float(inference_request.model_parameters['topP']),
            top_k=int(inference_request.model_parameters['topK']),
            temperature=float(inference_request.model_parameters['temperature']),
            repetition_penalty=float(inference_request.model_parameters['repetitionPenalty']),
            stop_sequences=None,
        )

        infer_response = None
        for generated_token in output:
            if cancelled: break
            print("generated_token", generated_token)
            infer_response = InferenceResult(
                    uuid=inference_request.uuid,
                    model_name=inference_request.model_name,
                    model_tag=inference_request.model_tag,
                    model_provider=inference_request.model_provider,
                    token=generated_token,
                    probability=None,
                    top_n_distribution=None
                )
        
            if not self.announcer.announce(infer_response, event="infer"):
                print("Cancelled inference")
                cancelled = True

    def local_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
       self.__error_handler__(self.__local_text_generation__, provider_details, inference_request)
    
    def __anthropic_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        print("Anthropic", inference_request.model_parameters, inference_request.model_name, provider_details.version_key)

        c = anthropic.Client(provider_details.api_key)

        response = c.completion_stream(
            prompt=f"{anthropic.HUMAN_PROMPT} {inference_request.prompt}{anthropic.AI_PROMPT}",
            stopSequences=[anthropic.HUMAN_PROMPT] + inference_request.model_parameters['stopSequences'],
            temperature=float(inference_request.model_parameters['temperature']),
            topP=float(inference_request.model_parameters['topP']),
            topK=int(inference_request.model_parameters['topK']),
            max_tokens_to_sample=inference_request.model_parameters['maximumLength'],
            model=inference_request.model_name,
            stream=True,
        )

        completion = ""
        cancelled = False

        for data in response:
            new_completion = data["completion"]
            generated_token = new_completion[len(completion):]
            if cancelled: continue

            if not self.announcer.announce(InferenceResult(
                uuid=inference_request.uuid,
                model_name=inference_request.model_name,
                model_tag=inference_request.model_tag,
                model_provider=inference_request.model_provider,
                token=generated_token,
                probability=None,
                top_n_distribution=None
             ), event="infer"):
                cancelled = True

            completion = new_completion

    def anthropic_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__anthropic_text_generation__, provider_details, inference_request)
    
    def __aleph_alpha_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        client = aleph_client(provider_details.api_key)
        request = CompletionRequest(
            prompt = Prompt.from_text(inference_request.prompt),
            temperature= inference_request.model_parameters['temperature'],
            maximum_tokens=inference_request.model_parameters['maximumLength'],
            top_p=float(inference_request.model_parameters['topP']),
            top_k=int(inference_request.model_parameters['topK']),
            presence_penalty=float(inference_request.model_parameters['repetitionPenalty']),
            stop_sequences=inference_request.model_parameters['stopSequences']
        )
        
        response = client.complete(request, model=inference_request.model_name)
        
        if not self.announcer.announce(InferenceResult(
            uuid=inference_request.uuid,
            model_name=inference_request.model_name,
            model_tag=inference_request.model_tag,
            model_provider=inference_request.model_provider,
            token=response.completions[0].completion,
            probability=None,
            top_n_distribution=None
        ), event="infer"):
            cancelled = True

    def aleph_alpha_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__aleph_alpha_text_generation__, provider_details, inference_request)
    
    def get_announcer(self):
        return self.announcer 

class ModelManager:
    def __init__(self, sse_client):
        self.sse_client = sse_client
        self.local_cache = {}
        self.inference_manager = InferenceManager(sse_client)

    def get_available_models(self):
        provider_model_map = {}
        for providers in MODELS_JSON:
            if "models" in MODELS_JSON[providers]:
                provider_model_map[providers] = MODELS_JSON[providers]['models'].keys()
            else:
                provider_model_map[providers] = []
        return provider_model_map
    
    def get_all_models_with_parameters(self):
        provider_model_map = self.get_available_models()
        model_parameters = {}
        for provider in provider_model_map:
            for model in provider_model_map[provider]:
                model_parameters[model] = self.get_model_with_parameters(provider=provider, model_name=model)
                model_parameters[model]["name"] = model
                model_parameters[model]["parameters"] = model_parameters[model]["parameters"]
                model_parameters[model]["provider"] = provider
        return model_parameters

    def get_model_with_parameters(self, provider: str, model_name: str):
        return MODELS_JSON[provider]['models'][model_name]
    
    def get_model_attribute(self, model_name: str, attribute: str):
        return {}

    def get_provider_key(self, provider: str):
        provider_key = ""
        provider_value = ""
        if (provider == "openai"):
            provider_key = "OPENAI_API_KEY"
        elif (provider == "cohere"):
            provider_key = "COHERE_API_KEY"
        elif (provider == "huggingface"):
            provider_key = "HUGGINGFACE_API_KEY"
        elif (provider == "forefront"):
            provider_key = "FOREFRONT_API_KEY"
        elif (provider == "anthropic"):
            provider_key = "ANTHROPIC_API_KEY"
        elif (provider == "aleph-alpha"):
            provider_key = "ALEPH_ALPHA_API_KEY"
        else:
            provider_key = "UNKNOWN_API_KEY"
        if os.environ.get(provider_key) is None:
            provider_value = ""
        else:
            provider_value = os.getenv(provider_key)
        return provider_value
    
    def text_generation(self, inference_request: InferenceRequest):
        provider_details = ProviderDetails(
            api_key=self.get_provider_key(inference_request.model_provider),
            version_key=None
        )

        print("received inference request", inference_request.model_provider)
        if inference_request.model_provider == "openai":
            return self.inference_manager.openai_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "cohere":
            return self.inference_manager.cohere_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "huggingface":
            return self.inference_manager.huggingface_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "forefront":
            provider_details.version_key = self.get_model_attribute(f"forefront:{inference_request.model_name}", "version")
            inference_request.model_name = self.get_model_attribute(f"forefront:{inference_request.model_name}", "name")
            return self.inference_manager.forefront_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "textgeneration":
            return self.inference_manager.local_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "anthropic":
            return self.inference_manager.anthropic_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "aleph-alpha":
            return self.inference_manager.aleph_alpha_text_generation(provider_details, inference_request)
        else:
            raise Exception(f"Unknown model provider, {inference_request.model_provider}. Please add a generation function in InferenceManager or route in ModelManager.text_generation")
    
    def get_announcer(self):
        return self.inference_manager.get_announcer()

class GlobalState:
    model_manager = ModelManager(SSE_MANAGER)
    sse_client = SSE_MANAGER

def bulk_completions(tasks: List[InferenceRequest]):
    time.sleep(1)

    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = []
        for inference_request in tasks:
            futures.append(executor.submit(GlobalState.model_manager.text_generation, inference_request))

        [future.result() for future in futures]
        
    GlobalState.model_manager.get_announcer().announce(InferenceResult(
        uuid=tasks[0].uuid,
        model_name=None,
        model_tag=None,
        model_provider=None,
        token=None,
        probability=None,
        top_n_distribution=None
    ), event="done")

@click.group()
def cli():
    pass

@cli.command()
@click.option('--host',  '-h', default='localhost', help='The host to bind to [default: localhost]')
@click.option('--port', '-p', default=5432, help='The port to bind to [default: 5432]')
@click.option('--env', '-e', default=".env", help='Environment file to read and store API keys')
@click.option('--models', '-m', default=None, help='Config file containing model information')
def run(host, port, env, models):
    global DOTENV_FILE_PATH, MODELS_JSON
    DOTENV_FILE_PATH = env
    
    if models and os.path.exists(models):
        MODELS_JSON = json.loads(open(models).read())
    else:
        MODELS_JSON = json.loads(pkg_resources.open_text("server", 'models.json').read())

    app.run(host=host, port=port)

if __name__ == '__main__':
    cli()