# import gevent
# from gevent import monkey
# monkey.patch_all(thread=False, socket=False)

import json
import os
import time
import cachetools
import requests
import sseclient
from sse import Message
import sseserver as sse_server
from sseserver import SSEQueueWithTopic, SSEQueue
import queue
import math
import openai
import uuid
import urllib
import warnings

from datetime import datetime
from dataclasses import dataclass
from dotenv import load_dotenv, set_key, unset_key, find_dotenv
from typing import Callable, List, Union
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, Response, abort, send_from_directory, stream_with_context
from flask_cors import CORS

from transformers import T5Tokenizer
google_tokenizer = T5Tokenizer.from_pretrained("google/flan-t5-xl")

DOTENV_FILE = find_dotenv()
if not DOTENV_FILE:
    warnings.warn("No .env file found, using default environment variables, creating one locally")
    f = open(".env", "w")
    f.close()
    DOTENV_FILE = find_dotenv()
load_dotenv(override=True)

# global sse server manager
SSE_MANAGER = SSEQueue()
# SSE_MANAGER.start()

app = Flask(__name__, static_folder='../app/dist')
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path == "" or not os.path.exists(app.static_folder + '/' + path):
        path = 'index.html'

    #if 'br' in request.headers.get('Accept-Encoding', ''):
    #    path = path + '.br'
    #elif 'gzip' in request.headers.get('Accept-Encoding', ''):
    #    path = path + '.gz'
        
    return send_from_directory(app.static_folder, path)

# Testing route
@app.route('/hello')
def hello():
    return "Hello World!"

@app.route("/api/listen", methods=["POST", "OPTIONS"])
def listen():
    global SSE_MANAGER
    #print("request in stream", request.data)
    uuid = "1" # this is sent upon connection from the frontend
    print("Streaming SSE", uuid)

    @stream_with_context
    def generator():
        messages = SSE_MANAGER.listen()
        print("genertor queue", messages)
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
            SSE_MANAGER.sse_publish("cancel_inference", message=json.dumps({"uuid": uuid}))
            print("GeneratorExit")
        finally:
            #close and clean up redis connection
            pass

    return Response(stream_with_context(generator()), mimetype='text/event-stream')

# Routes to store, reload, and check API keys
# Store API key in .env file, for given provider
@app.route('/api/store-api-key', methods=['POST'])
def store_api_key():
    data = request.get_json(force=True)
    print(data)
    model_provider = data['model_provider'].lower()
    model_provider_value = data['api_key']
    if (model_provider == "openai"):
        provider_key = "OPENAI_API_KEY"
    elif (model_provider == "cohere"):
        provider_key = "COHERE_API_KEY"
    elif (model_provider == "huggingface"):
        provider_key = "HF_API_KEY"
    elif (model_provider == "forefront"):
        provider_key = "FOREFRONT_API_KEY"
    else:
        provider_key = "UNKNOWN_API_KEY"
    set_key(DOTENV_FILE, provider_key, model_provider_value)

    response = jsonify({'status': 'success'})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/check-key-store', methods=['POST'])
def check_key_store():
    data = request.get_json(force=True)
    print(data)
    response = {}
    for i, model_provider in enumerate(data['model_provider']):
        model_provider = model_provider.lower()
        if (model_provider == "openai"):
            provider_key = "OPENAI_API_KEY"
        elif (model_provider == "cohere"):
            provider_key = "COHERE_API_KEY"
        elif (model_provider == "huggingface"):
            provider_key = "HF_API_KEY"
        elif (model_provider == "forefront"):
            provider_key = "FOREFRONT_API_KEY"
        else:
            provider_key = "UNKNOWN_API_KEY"
        key = data['model_provider'][i]
        if os.environ.get(provider_key) is None:
            # return empty is key not found
            response[key] = ""
        else:
            # return key if found
            response[key] = os.getenv(provider_key)

    response = jsonify(response)
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

def create_response_message(message: str, status_code: int) -> Response:
    response = jsonify({'status': message})
    response.status_code = status_code
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

#@app.before_request
@app.route("/api/stream", methods=["POST"])
def stream_inference():
    # if (request.path != "/api/stream"):
    #     return
    # if request.method == 'OPTIONS':
    #     return create_response_message("OK", 200)
        
    data = request.get_json(force=True)
    print(f"Path: {request.path}, Request: {data}")

    if not isinstance(data['prompt'], str) or not isinstance(data['models'], list):
        return create_response_message("Invalid request", 400)
    
    request_uuid = "1"
    # request.data = json.dumps({"uuid": request_uuid})

    prompt = data['prompt']
    models = data['models']
    providers = ["openai", "cohere", "huggingface", "forefront", "textgeneration", "anthropic"]

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
            required_parameters = ["temperature", "top_p", "maximum_length", "stop_sequences", "frequency_penalty", "presence_penalty", "stop_sequences"]
        elif provider == "cohere":
            print("identified cohere")
            name = name.removeprefix("cohere:")
            required_parameters = ["temperature", "top_p", "top_k", "maximum_length", "presence_penalty", "frequency_penalty", "stop_sequences"]
        elif provider == "huggingface":
            name = name.removeprefix("huggingface:")
            required_parameters = ["temperature", "top_p", "top_k", "repetition_penalty", "maximum_length", "stop_sequences"]
        elif provider == "forefront":
            name = name.removeprefix("forefront:")
            required_parameters = ["temperature", "top_p", "top_k", "repetition_penalty", "maximum_length", "stop_sequences"]
        elif provider == "textgeneration":
            name = name.removeprefix("textgeneration:")
            required_parameters = ["temperature", "top_p",  "top_k", "repetition_penalty", "maximum_length"]
        elif provider == "anthropic":
            name = name.removeprefix("anthropic:")
            required_parameters = ["temperature", "top_p",  "top_k", "maximum_length", "stop_sequences"]

        for param in required_parameters:
            if param not in parameters:
                return create_response_message(f"Missing required parameter: {name} - {provider} - {param}", 400)

            if param == "stop_sequences":
                if parameters[param] is None:
                    parameters[param] = []
                if (not isinstance(parameters[param], list) and not parameters[param] == None):
                    return create_response_message(f"Invalid stop_sequences parameter", 400)
            elif not isinstance(parameters[param], (int, float)) and not (isinstance(parameters[param], str) and parameters[param].replace('.', '').isdigit()):
                return create_response_message(f"Invalid parameter: {param} - {name}", 400)
            
            sanitized_params[param] = parameters[param]

        all_tasks.append(InferenceRequest(
            uuid=request_uuid, model_name=name, model_tag=tag, model_provider=provider,
            model_parameters=sanitized_params, prompt=prompt)
        )
        print("all tasks: ", all_tasks)

    if len(all_tasks) > 0:
        bulk_completions(all_tasks)
        # gevent.spawn(bulk_completions, all_tasks) #lock
        #else:
        #return create_response_message("Too many pending requests", 429)
        return create_response_message(message="success", status_code=200)
    else:
        print("sending response back")
        return create_response_message("I see you", 500)

@app.route('/api/all_models', methods=['GET'])
def all_models():
    print("recieved request for all models")
    providers = ["forefront", "anthropic", "textgeneration", "huggingface", "cohere", "openai"]
    models_by_provider = {}
    for provider in providers:
        models_by_provider[provider] = []

    models = GlobalState.model_manager.get_all_models_with_parameters()

    for model_tag in models:
        model = models[model_tag]
        models_by_provider[model['provider']].append((model_tag, model))

    sorted_models = {}
    
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

CORS(app)

public_key = b""""
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlLX6VS+hjfsckusKCoMg
3op6g5EAfHPohyBsAoSS1GcvpJZLKacKNEW5SHpvPs9WGFfmAeJwbK6HfIkvrbOX
B/3MxxTBsD/c5HA2WTONPr797Q7O2m1pMzC7acqad2iBWM+50+56wDgxyHd20wOE
g9kTW2IvscXQUHdAIqdqKVWsMfyfERDy12dN/vp7AICZjlyT38idib1bQgylKTl1
APgZgVqnE0IM0ER6luNFzWMSjZ3CpJNx0UTiLW3H/DLFfvxfzOIqYLEm3ylGxGHB
/Kndhq8/yjNG2YJPALGR8p11+MEgdt4osDZrdgUDDKxDimhq+WPN8leKxVg9TPF/
rQIDAQAB
-----END PUBLIC KEY-----"""

@dataclass
class ProviderDetails:
    api_key: str
    version_key: str

@dataclass
class InferenceRequest:
    uuid: str
    model_name: str
    model_tag: str
    model_provider: str
    model_parameters: dict
    prompt: str

@dataclass
class ProablityDistribution:
    log_prob_sum: float
    simple_prob_sum: float
    tokens: dict

@dataclass
class InferenceResult:
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
            "model_name": infer_result.model_name,
            "model_tag": infer_result.model_tag,
        }

        if infer_result.probability is not None:
            encoded["prob"] = round(math.exp(infer_result.probability) * 100, 2) 

        if infer_result.top_n_distribution is not None:
            encoded["top_n_distribution"] = {
                "log_prob_sum": infer_result.top_n_distribution.log_prob_sum,
                "simple_prob_sum": infer_result.top_n_distribution.simple_prob_sum,
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
            max_tokens=inference_request.model_parameters['maximum_length'],
            top_p=inference_request.model_parameters['top_p'],
            #stop=inference_request.model_parameters['stop_sequences'],
            frequency_penalty=inference_request.model_parameters['frequency_penalty'],
            presence_penalty=inference_request.model_parameters['presence_penalty'],
            stream=True
        )

        total_tokens = 0
        tokens = ""
        cancelled = False

        for event in response:
            response = event['choices'][0]
            if response['finish_reason'] == "stop":
                break

            delta = response['delta']

            if not "content" in delta:
                continue
            generated_token = delta["content"]
            tokens += generated_token

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
            

        #print("Final tokens", tokens)

    def __openai_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        openai.api_key = provider_details.api_key

        response = openai.Completion.create(
            model=inference_request.model_name,
            prompt=inference_request.prompt,
            temperature=inference_request.model_parameters['temperature'],
            max_tokens=inference_request.model_parameters['maximum_length'],
            top_p=inference_request.model_parameters['top_p'],
            stop=None if len(inference_request.model_parameters['stop_sequences']) == 0 else inference_request.model_parameters['stop_sequences'],
            frequency_penalty=inference_request.model_parameters['frequency_penalty'],
            presence_penalty=inference_request.model_parameters['presence_penalty'],
            logprobs=5,
            stream=True
        )
        total_tokens = 0
        tokens = ""
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

                total_tokens += 1

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
             
                #print("prob_dist", prob_dist)
                tokens += generated_token
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
                #print("IndexError", event)
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
        
        #print("Final tokens", tokens)

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
                "p": float(inference_request.model_parameters['top_p']),
                "k": int(inference_request.model_parameters['top_k']),
                "stop_sequences": inference_request.model_parameters['stop_sequences'],
                "frequency_penalty": float(inference_request.model_parameters['frequency_penalty']),
                "presence_penalty": float(inference_request.model_parameters['presence_penalty']),
                "return_likelihoods": "GENERATION",
                "max_tokens": int(inference_request.model_parameters['maximum_length']),
                "stream": True,
            }),
            stream=True
        ) as response:
            if response.status_code != 200:
                raise Exception(f"Request failed: {response.status_code} {response.reason}")

            total_tokens = 0
            cancelled = False

            for token in response.iter_lines():
                token = token.decode('utf-8')
                token_json = json.loads(token)
                # print("TOKEN JSON", token_json)
                #print("token_json", token_json)
                total_tokens += 1
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
        response = requests.request("POST",
            f"https://api-inference.huggingface.co/models/{inference_request.model_name}",
            headers={"Authorization": f"Bearer {provider_details.api_key}"},
            json={
                "inputs": inference_request.prompt,
                "stream": True,
                "parameters": {
                    "max_length": min(inference_request.model_parameters['maximum_length'], 250), # max out at 250 tokens per request, we should handle for this in client side but just in case
                    "temperature": inference_request.model_parameters['temperature'],
                    "top_k": inference_request.model_parameters['top_k'],
                    "top_p": inference_request.model_parameters['top_p'],
                    "repetition_penalty": inference_request.model_parameters['repetition_penalty'],
                    "stop_sequences": inference_request.model_parameters['stop_sequences'],
                },
                "options": {
                    "use_cache": False
                }
            },
            timeout=60
        )

        #print response content-type
        content_type = response.headers["content-type"]
        print("content_type", content_type)
        #check if 200
        total_tokens = 0
        cancelled = False

        if response.status_code != 200:
            raise Exception(f"Request failed: {response.status_code} {response.reason}")

        if content_type == "application/json":
            #print("response", response.status_code, response.reason)
            return_data = json.loads(response.content.decode("utf-8"))
            outputs = return_data[0]["generated_text"]
            outputs = outputs.removeprefix(inference_request.prompt)
            print("[Got HF Model output]")

            #for word in [outputs[i:i+4] for i in range(0, len(outputs), 4)]:
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
                "top_p": float(inference_request.model_parameters['top_p']),
                "top_k": int(inference_request.model_parameters['top_k']),
                "temperature":  float(inference_request.model_parameters['temperature']),
                "repetition_penalty":  float(inference_request.model_parameters['repetition_penalty']),
                "length": int(inference_request.model_parameters['maximum_length']),
                "stop": inference_request.model_parameters['stop_sequences'],
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
            full_completion = ""

            for packet in sseclient.SSEClient(response).events():
                generated_token = None
                probability = None
                prob_dist = None

                if packet.event == "update":
                    full_completion = packet.data
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
                    #print("message", packet.data)
                    data = json.loads(packet.data)

                    logprobs = data["logprobs"][0]
                    tokens = logprobs["tokens"]
                    token_logprobs = logprobs["token_logprobs"]

                    #print(f"Tokens: {len(tokens)}, Total: {total_tokens} ")
                    new_tokens = tokens[total_tokens:]

                    #print("Old Tokens", tokens[:total_tokens])
                    #print("New Tokens", tokens[total_tokens:])
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

    def __hosted_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        #wait for announcement from "llama:inference:response"
        pubsub = GlobalState.sse_client
        # pubsub.sse_subscribe(f"alpaca:inference:complete:{inference_request.uuid}")

        for message in pubsub.listen():
            if message["type"] == "message":
                print("Inference complete!!!")
                pubsub.unsubscribe(f"alpaca:inference:complete:{inference_request.uuid}")
                pubsub = None
                break

    def hosted_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
       self.__error_handler__(self.__hosted_text_generation__, provider_details, inference_request)
    
    def get_announcer(self):
        return self.announcer 

class ModelManager:
    def __init__(self, sse_client):
        self.sse_client = sse_client
        self.local_cache = {}
        self.inference_manager = InferenceManager(sse_client)
        self.models_json = json.load(open('models.json',))

    def get_available_models(self):
        # model provider --> model map
        provider_model_map = {}
        for providers in self.models_json:
            if "models" in self.models_json[providers]:
                provider_model_map[providers] = self.models_json[providers]['models'].keys()
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
        return self.models_json[provider]['models'][model_name]
    
    def get_model_attribute(self, model_name: str, attribute: str):
        return {}
        #return self.redis_client.hget(f"model:{model_name}", attribute)

    def get_provider_key(self, provider: str):
        # TODO: abstract to just one function its duplicated
        provider_key = ""
        provider_value = ""
        if (provider == "openai"):
            provider_key = "OPENAI_API_KEY"
        elif (provider == "cohere"):
            provider_key = "COHERE_API_KEY"
        elif (provider == "huggingface"):
            provider_key = "HF_API_KEY"
        elif (provider == "forefront"):
            provider_key = "FOREFRONT_API_KEY"
        else:
            provider_key = "UNKNOWN_API_KEY"
        if os.environ.get(provider_key) is None:
            # return empty is key not found
            provider_value = ""
        else:
            # return key if found
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
            return self.inference_manager.hosted_text_generation(provider_details, inference_request)
    
    def get_announcer(self):
        return self.inference_manager.get_announcer()

class GlobalState:
    model_manager = ModelManager(SSE_MANAGER)
    sse_client = SSE_MANAGER

def bulk_completions(tasks: List[InferenceRequest]): #lock
    time.sleep(1) # enough time for the SSE to establish connection, we don't want to drop any tokens

    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = []
        for inference_request in tasks:
            print("sending inference request:", inference_request.model_provider)
            futures.append(executor.submit(GlobalState.model_manager.text_generation, inference_request))

        results = [future.result() for future in futures]
        
    # completion_greenlets = [gevent.spawn(GlobalState.model_manager.text_generation, inference_request) for inference_request in tasks]
    # gevent.joinall(completion_greenlets)

    GlobalState.model_manager.get_announcer().announce(InferenceResult(
        uuid=tasks[0].uuid,
        model_name=None,
        model_tag=None,
        model_provider=None,
        token=None,
        probability=None,
        top_n_distribution=None
    ), event="done")

    #print("All done, releasing lock?")
    #lock.release()

if __name__ == '__main__':
    # start sse before the server
    app.run(host='127.0.0.1', port=1235, debug=True, threaded=True)