import json
import logging
import os
import time
import warnings
from flask import Flask, request, jsonify, Response, send_from_directory, stream_with_context
from flask_cors import CORS
import numpy as np
import requests
import transformers
from transformers import AutoTokenizer, AutoConfig, PreTrainedModel, PreTrainedTokenizer, StoppingCriteria, StoppingCriteriaList
from huggingface_hub import hf_hub_download, try_to_load_from_cache, scan_cache_dir, _CACHED_NO_EXIST
from dotenv import load_dotenv, set_key, unset_key, find_dotenv
import torch
import importlib
import cohere
import openai
from message_announcer import MessageAnnouncer
from generator import greedy_search_generator
from utils import format_sse, get_num_tokens, format_token_probabilities
from stoppingcriteria import StoppingCriteriaSub
from concurrent.futures import ThreadPoolExecutor
import gc
import threading
import psutil

# monkey patch for transformers
transformers.generation.utils.GenerationMixin.greedy_search = greedy_search_generator

# set up environment
dotenv_file = find_dotenv()
if not dotenv_file:
    warnings.warn("No .env file found, using default environment variables, creating one locally")
    f = open(".env", "w")
    f.close()
    dotenv_file = find_dotenv()
load_dotenv(override=True) # load file
    
# set up flask andcors
os.environ['TOKENIZERS_PARALLELISM'] = 'true'
app = Flask(__name__, static_folder='./build')
CORS(app)

cohere_key = ""
if "COHERE_API_KEY" in os.environ:
    cohere_key = os.getenv("COHERE_API_KEY")
hf_key = ""
if "HF_API_KEY" in os.environ:
    hf_key = os.getenv("HF_API_KEY")

# Set up message announcer for streaming
ANNOUNCER = MessageAnnouncer() 

# Endpoints
HUGGINGFACE_ENDPOINT = "https://api-inference.huggingface.co/models"

# Set constants
MODULE = importlib.import_module("transformers") # dynamic import of module class, AutoModel not good enough for text generation
DEVICE = "cuda" if torch.cuda.is_available() else "cpu" # suport gpu inference if possible
MODEL_NAME =  "gpt2" # model name - default to gpt2
MODEL = None # model class
TOKENIZER = None # tokenize class

# routes for production build
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

# Allow client to establish connection for streaming
# TODO: REVIEW THREAD SAFETY AND PROCESS SAFETY of this method
@app.route("/api/listen", methods=["GET"])
def listen():
    global ANNOUNCER
    def stream():
        messages = ANNOUNCER.listen() # returns a queue.Queue
        try:
            while True:
                msg = messages.get() # blocks until a new message arrives
                if msg == "[DONE]": break # push dummy message to end connection
                yield msg
        except GeneratorExit:
            print('Generator exit, stopping listener')
            ANNOUNCER.stop_listening()
        finally:
            print('Stream ended, stopping listener')
            ANNOUNCER.stop_listening()
    # sending function back, response takes infinite amount of time
    return Response(stream_with_context(stream()), mimetype='text/event-stream')

'''
This route handles all the connections for the playground page on the clientside.
Regardless of token streaming support, we send inference results over SSE
Any failures or errors are sent as a HTTP response back to client
'''
@app.route('/api/playground', methods=['POST'])
def playground():
    data = request.get_json(force=True)
    print(f"Received request for model {data['model_name']}")
    print(f"Request: {data}")
    # Model based routing, return is a Response object
    if data['model_name'].startswith("huggingface:"):
        return huggingface_remote_playground(data)
    elif data['model_name'].startswith("openai:"):
        return openai_playground(data)
    elif data['model_name'].startswith("cohere:"):
        return cohere_playground(data)
    elif data['model_name'].startswith("textgeneration:"):
        return huggingface_local_playground(data)
    else:
        return create_response_message(message=f"Unknown model not supported: {data['model_name']}", status_code=500)

# Huggingface Remote Playground Inference
def huggingface_remote_playground(data: dict) -> Response:
    global ANNOUNCER
    # reload key, in case it has changed since server launch
    hf_key = os.getenv('HF_API_KEY') 
    headers = {"Authorization": f"Bearer {hf_key}"}
    model_name = data['model_name'].removeprefix("huggingface:")
    formatted_data = {
        "inputs": data['prompt'],
        "parameters": {
            "max_new_tokens": min(data['maximum_length'], 250), # max out at 250 tokens per request, we should handle for this in client side but just in case
            "temperature": data['temperature'],
            "top_k": data['top_k'],
            "top_p": data['top_p'],
            "repetition_penalty": data['repetition_penalty'],
        },
        "options": {
            "use_cache": False, 
            "wait_for_model": True, # sometimes longer generation, but prevents us having to re-request when available and it would error out multiple times
        }
    }
    formatted_data = json.dumps(formatted_data)
    formatted_endpoint = f"{HUGGINGFACE_ENDPOINT}/{model_name}"
    try:
        response = requests.request("POST", formatted_endpoint, headers=headers, data=formatted_data)
        response.raise_for_status()
    except requests.exceptions.HTTPError as e:
        return Response(f"HTTP error raised: {e}", status_code=500)
    except requests.exceptions.Timeout as e:
        #TODO: set up retry logic, shouldn't need to with wait_for_model but just in case
        return Response(f"Huggingface Inference API request timed out, try again. Trace: {e}", status_code=500)
    except requests.exceptions.RequestException as e:
        return Response(f"Request error: {e}", status_code=500)
    except Exception as e:
        return Response(f"Unknown Error {e}", status_code=500)
    # Can possibly get bad JSON returned either from Huggingface or from our own code
    try:
        return_data = json.loads(response.content.decode("utf-8"))
        outputs = return_data[0]["generated_text"]
    except ValueError as e:
        return Response(f"Error parsing response from Huggingface API: {e}", status_code=500)

    # instead of return_full_text, we will manually remove the prompt
    outputs = outputs.removeprefix(data['prompt'])
    # Return the sequence as a json object in response
    if ANNOUNCER.send_message():
        ANNOUNCER.announce(format_sse(data=outputs))
        ANNOUNCER.announce("[DONE]")
    
    return create_response_message(message="success", status_code=200)

# OpenAI Remote Playground Inference
def openai_playground(data: dict) -> Response:
    global ANNOUNCER
    openai.api_key = os.getenv("OPENAI_API_KEY") # have to do to gurantee reload of key
    model_name = data['model_name'].removeprefix("openai:")
    try:
        response = openai.Completion.create(
            model=model_name,
            prompt=data['prompt'],
            temperature=data['temperature'],
            max_tokens=data['maximum_length'],
            top_p=data['top_p'],
            stop=data['stop'],
            frequency_penalty=data['frequency_penalty'], # TODO: add
            presence_penalty=data['presence_penalty'], # TODO: add
            stream=True,
            logprobs=5
        )
    except openai.error.Timeout as e:
        #Handle timeout error, e.g. retry or log
        return create_response_message(f"OpenAI API request timed out: {e}", status_code=500)
    except openai.error.APIError as e:
        #Handle API error, e.g. retry or log
        return create_response_message(f"OpenAI API returned an API Error: {e}", status_code=500)
    except openai.error.APIConnectionError as e:
        #Handle connection error, e.g. check network or log
        return create_response_message(f"OpenAI API request failed to connect: {e}", status_code=500)
    except openai.error.InvalidRequestError as e:
        #Handle invalid request error, e.g. validate parameters or log
        return create_response_message(f"OpenAI API request was invalid: {e}", status_code=500)
    except openai.error.AuthenticationError as e:
        #Handle authentication error, e.g. check credentials or log
        return create_response_message(f"OpenAI API request was not authorized: {e}", status_code=500)
    except openai.error.PermissionError as e:
        #Handle permission error, e.g. check scope or log
        return create_response_message(f"OpenAI API request was not permitted: {e}", status_code=500)
    except openai.error.RateLimitError as e:
        #Handle rate limit error, e.g. wait or log
        return create_response_message(f"OpenAI API request exceeded rate limit: {e}", status_code=500)
    except Exception as e:
        # Unknown handle for it here
        return create_response_message(f"Unknown Error {e}", status_code=500)

    # stream tokens to client
    full_response = []
    for event in response:
        if not ANNOUNCER.send_message(): break # stop if cancel sent by client
        event_text = event['choices'][0]['text']
        # instead of erroring out, return -1 for logprob
        try:
            token_probs = format_token_probabilities(event['choices'][0]["logprobs"]['top_logprobs'][0], chosen_token=event_text, model_tag="openai")
            full_response.append(event_text)
            msg = format_sse(data=event_text, prob=token_probs)
        except IndexError:
            msg = format_sse(data=event_text, prob=-1)
        time.sleep(0.075)
        ANNOUNCER.announce(msg) # send message out to all listeners
    
    print("".join(full_response))
    # if stream finished, want to close connection
    if ANNOUNCER.send_message():
        ANNOUNCER.announce("[DONE]")
    
    return create_response_message(message="success", status_code=200)

# Cohere Playground Inference
def cohere_playground(data: dict) -> Response:
    # using CURL to support streaming - early release
    global cohere_key, ANNOUNCER
    headers = {
        "Authorization": f"Bearer {cohere_key}",
        "Content-Type": "application/json",
        "Cohere-Version": "2021-11-08",
    }
    data = {
        "prompt": data['prompt'],
        "model": data['model_name'].removeprefix("cohere:"),
        "temperature": float(data['temperature']),
        "p": float(data['top_p']),
        "k": int(data['top_k']),
        "stop": data['stop'],
        "frequency_penalty": float(data['frequency_penalty']),
        "presence_penalty": float(data['presence_penalty']),
        "return_likelihoods": "GENERATION",
        "max_tokens": int(data['maximum_length']),
        "stream": True,
    }
    data = json.dumps(data)
    full_response = []
    try:
        print(cohere_key)
        with requests.post("https://api.cohere.ai/generate", headers=headers, data=data, stream=True) as response:
            for token in response.iter_lines():
                token = token.decode('utf-8')
                token_json = json.loads(token)
                token_probs = format_token_probabilities(token_json, chosen_token=token_json['token'], model_tag="cohere")
                print(token_probs)
                if not ANNOUNCER.send_message(): break
                ANNOUNCER.announce(format_sse(data=token_json['token'], prob=token_probs))
                full_response.append(token_json['token'])
                time.sleep(0.075)
    except requests.exceptions.HTTPError as e:
        return Response(f"HTTP error raised: {e}", status_code=500)
    except requests.exceptions.Timeout as e:
        #TODO: set up retry logic, shouldn't need to with wait_for_model but just in case
        return Response(f"Cohere API request timed out, try again. Trace: {e}", status_code=500)
    except requests.exceptions.RequestException as e:
        return Response(f"Request error: {e}", status_code=500)
    except Exception as e:
        return create_response_message(message=f"Unknown Error {e}", status_code=500)
    
    print("".join(full_response))
    # cancel might have been sent while waiting for response
    if ANNOUNCER.send_message():
        # ANNOUNCER.announce(format_sse(data=response.generations[0].text))
        ANNOUNCER.announce("[DONE]")

    return create_response_message(message="success", status_code=200)

# Huggingface Local Inference
def huggingface_local_playground(data: dict) -> Response:
    global MODEL, TOKENIZER, ANNOUNCER
    # set up stop sequences
    stopping_criteria = None
    stop_sequences = data['stop']
    if stop_sequences:
        stop_words_ids = [TOKENIZER.encode(stop_word) for stop_word in stop_sequences]
        stopping_criteria = StoppingCriteriaList([StoppingCriteriaSub(stops=stop_words_ids)])
    print(stopping_criteria)
    # set up inputs and tokenize
    inputs_str = data['prompt'].strip()
    inputs = TOKENIZER(inputs_str, return_tensors="pt")
    input_ids = inputs['input_ids'].to(DEVICE)
    attention_mask = inputs['attention_mask'].to(DEVICE)
    # generate outputs
    try:
        outputs = MODEL.generate(inputs=input_ids, 
            attention_mask=attention_mask, 
            max_new_tokens=data['maximum_length'], # max length of sequence
            temperature=data['temperature'], # randomness of model
            top_k=data['top_k'], # top k sampling
            top_p=data['top_p'], # top p sampling
            repetition_penalty=data['repetition_penalty'], # penalty for repeating words
            output_scores=True, 
            early_stopping=False,
            stopping_criteria=stopping_criteria if stopping_criteria else None,
            return_dict_in_generate=True,
        )
    except Exception as e:
        return create_response_message(message=f"Local Inference failed with error {e}", status_code=500)
    
    tokenizer_for_probs = AutoTokenizer.from_pretrained(MODEL_NAME, padding_side="left")
    curr_token = ""
    sentence = "<|endoftext|>"
    first_token = True
    for output in outputs:
        next_token, next_input_ids, next_scores = output
        if len(next_token.size()) > 1: continue # skip the last generated full array
        if not ANNOUNCER.send_message(): break # stop if cancel sent by client
        curr = TOKENIZER.convert_ids_to_tokens(next_token, skip_special_tokens=True)

        # get probabilities
        transition_scores = MODEL.compute_transition_scores(next_input_ids, next_scores, normalize_logits=True)
        input_length = 1 if MODEL.config.is_encoder_decoder else inputs.input_ids.shape[1]
        generated_tokens = next_input_ids[:, input_length:]
        tok = generated_tokens[0][-1]
        score = transition_scores[0][-1].detach().numpy()
        token_probs = format_token_probabilities({"logprob" : score.item()}, TOKENIZER.decode(next_token), "hf_local")
        print(token_probs)
            
        if (curr):
            curr = curr[0] # string with special character potentially
            time.sleep(0.05) # keep it consistent across models
            if (curr[0] == "Ġ"): # BPE tokenizer
                # dispatch old token because we have a new one
                curr_token = curr_token.replace("Ċ", "\n")
                curr_token = curr.replace("Ġ", " ")
                sentence += curr_token # we can yield here/print here
                msg = format_sse(data=curr_token, prob=format_token_probabilities({"logprob" : score.item()}, curr_token, "hf_local"), model_name=MODEL_NAME)
                ANNOUNCER.announce(msg) # send message out to all listeners
                # BPE
            elif (curr[0] == "▁"): # sentence piece tokenizer
                # dispatch old token because we have a new one
                if first_token:
                    curr_token = curr.replace("▁", "")
                    first_token = False
                else:
                    curr_token = curr.replace("▁", " ")
                sentence += curr_token # we can yield here/print here
                msg = format_sse(data=curr_token, prob=format_token_probabilities({"logprob" : score.item()}, curr_token, "hf_local"), model_name=MODEL_NAME)
                ANNOUNCER.announce(msg) # send message out to all listeners
            else:
                # append to previous token
                curr_token = curr
                curr_token = curr_token.replace("Ċ", "\n")
                msg = format_sse(data=curr_token, prob=format_token_probabilities({"logprob" : score.item()}, curr_token, "hf_local"), model_name=MODEL_NAME)
                ANNOUNCER.announce(msg)
                print(f'CURR: {curr}')
                sentence += curr_token
            
            curr_token = ""

    print(sentence)
    # dispatch last token, if we can
    if ANNOUNCER.send_message():
        if curr_token: ANNOUNCER.announce(format_sse(data=curr_token)) # send only if non empty
        ANNOUNCER.announce("[DONE]")

    # done send last message, this will close the connection
    return create_response_message(message="success", status_code=200)

def create_response_message(message: str, status_code: int) -> Response:
    response = jsonify({'status': message})
    response.status_code = status_code
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

# Initial call to setup model for inference, only called once. If model is already held in memory we can return it directly
@app.route('/api/setup-model', methods=['POST'])
def setup_model():
    global MODEL, MODEL_NAME, TOKENIZER
    data = request.get_json(force=True) # paramters given in json format
    data["model_name"] = data["model_name"].removeprefix("textgeneration:")
    if MODEL and MODEL.config._name_or_path == data['model_name']:
        # Model already loaded in memory
        MODEL_NAME = data['model_name']
        response = jsonify({'status': 'success'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    else:
        # Load model from transformers library
        MODEL, TOKENIZER = load_model(data['model_name'])
        MODEL_NAME = data['model_name']
        # return response
        response = jsonify({'status': 'success'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

# Download model for inference
@app.route('/api/download-model', methods=['POST'])
def request_model_download():
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


# Routes to check models in cache and download them in the background if requested
@app.route('/api/model-in-cache', methods=['GET'])
def check_model_in_cache():
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

# Routes to store, reload, and check API keys
# Store API key in .env file, for given provider
@app.route('/api/store-api-key', methods=['POST'])
def store_api_key():
    data = request.get_json(force=True)
    print(data)
    model_provider = data['model_provider'].lower()
    model_provider_key = data['api_key']
    if (model_provider == "openai"):
        model_provider = "OPENAI_API_KEY"
    elif (model_provider == "co:here"):
        model_provider = "COHERE_API_KEY"
    elif (model_provider == "huggingface hosted"):
        model_provider = "HF_API_KEY"
    else:
        model_provider = "UNKNOWN_API_KEY"
    set_key(dotenv_file, model_provider, model_provider_key)
    reload_clients(data['model_provider'].lower())

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
            model_provider = "OPENAI_API_KEY"
        elif (model_provider == "co:here"):
            model_provider = "COHERE_API_KEY"
        elif (model_provider == "huggingface hosted"):
            model_provider = "HF_API_KEY"
        else:
            model_provider = "UNKNOWN_API_KEY"
        key = data['model_provider'][i]
        if os.environ.get(model_provider) is None:
            # return empty is key not found
            response[key] = ""
        else:
            # return key if found
            response[key] = os.getenv(model_provider)

    response = jsonify(response)
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

# ensure api keys are updated
def reload_clients(model_provider: str):
    global cohere_key
    global hf_key
    load_dotenv(override=True) # reload .env file
    if (model_provider == "openai"):
        openai.api_key = os.getenv("OPENAI_API_KEY")
    elif (model_provider == "co:here"):
        cohere_key = os.getenv('COHERE_API_KEY')
        print("updated: ", cohere_key)
    elif (model_provider == "HuggingFace Hosted"):
        hf_key = os.getenv("HF_API_KEY")

# Helper function to load model from transformers library
def load_model(model_name: str)-> tuple([PreTrainedModel, PreTrainedTokenizer]):
    '''
    Load model from transformers library
    dynamically instantiates the right model class for text generation from model config architecture
    '''
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    config = AutoConfig.from_pretrained(model_name) # load config for model
    model_class = getattr(MODULE, config.architectures[0]) # get model class from config
    model = model_class.from_pretrained(model_name, config=config) # dynamically load right model class for text generation

    param_size = 0
    for param in model.parameters():
        param_size += param.nelement() * param.element_size()
    buffer_size = 0
    for buffer in model.buffers():
        buffer_size += buffer.nelement() * buffer.element_size()

    size_all_mb = (param_size + buffer_size) / 1024**2
    print('model size: {:.3f}MB'.format(size_all_mb))

    if DEVICE == 'cuda':
        device_memory = torch.cuda.get_device_properties(0).total_memory / 1024**2
    else:
        device_memory = psutil.virtual_memory().total / 1024**2

    print('device memory: {:.3f}MB'.format(device_memory))

    if size_all_mb > device_memory * 0.95: #some padding
        raise Exception('Model size is too large for host to run inference on')
    
    model.to(DEVICE) # gpu inference if possible
    return model, tokenizer

def open_ai_completion(model_data, prompt, uuid):
    try:
        global ANNOUNCER
        openai.api_key = os.environ['OPENAI_API_KEY']
        model_name, model_tag, parameters = model_data

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[INITIALIZING]"
        ))

        response =  openai.Completion.create(
            model=model_name.removeprefix("openai:"),
            prompt=prompt,
            **parameters,
            frequency_penalty=0, # TODO: add
            presence_penalty=0, # TODO: add
            stream=True,
            logprobs=3
        )

        for event in response:
            if not ANNOUNCER.send_message(): break # stop if cancel sent by client
            event_text = event['choices'][0]['text']
            msg = format_sse(   
                model_tag=model_tag,
                model_name=model_name,
                data=event_text,
                prob=event['choices'][0]['logprobs']['token_logprobs'][0]
            )
            time.sleep(0.05)
            ANNOUNCER.announce(msg) # send message out to all listeners

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[COMPLETED]"
        ))
    except Exception as e:
        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data=f"[ERROR] {e}"
        ))
        print(e)

def cohere_completion(model_data, prompt, uuid):
    try:
        global co, ANNOUNCER
        co = cohere.Client(os.environ['COHERE_API_KEY'])
        model_name, model_tag, parameters = model_data

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[INITIALIZING]"
        ))

        start_time = time.time()

        response = co.generate(
            model=model_name.removeprefix("cohere:"),
            prompt=prompt.strip(),
            **parameters
        )

        response_txt = response.generations[0].text
        [_ for _ in response_txt] # force evaluation of response
        end_time = time.time()
        tokenized_results = co.tokenize(response.generations[0].text)

        total_seconds_elapsed = end_time - start_time
        tokens_per_second = len(tokenized_results.tokens) / total_seconds_elapsed

        for token in tokenized_results.token_strings:
            if not ANNOUNCER.send_message(): break
            ANNOUNCER.announce(format_sse(  
                model_name=model_name, 
                model_tag=model_tag,
                data=token
            ))
            time.sleep(1/tokens_per_second)

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[COMPLETED]"
        ))
    except Exception as e:
        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data=f"[ERROR] {e}"
        ))
        print(e)

    return response.generations[0].text

def huggingface_completion(model_data, prompt, uuid): 
    try:
        global hf_key, ANNOUNCER
        hf_key = os.environ['HF_API_KEY']
        model_name, model_tag, parameters = model_data
        
        model_name_no_prefix = model_name.removeprefix("huggingface:")
        headers = {"Authorization": f"Bearer {hf_key}"}
        API_URL = f"https://api-inference.huggingface.co/models/{model_name_no_prefix}"
        data = {
            "inputs":     prompt,
            "parameters": parameters,
            "options": {
                "use_cache": False,
                "wait_for_model": True,
            }
        }
        data = json.dumps(data)

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[INITIALIZING]"
        ))

        response = requests.request("POST", API_URL, headers=headers, data=data)
        return_data = json.loads(response.content.decode("utf-8"))
        #print("returned data", return_data)
        if "error" in return_data:
            raise Exception(return_data["error"])
        outputs = return_data[0]["generated_text"]

        for word in [outputs[i:i+4] for i in range(0, len(outputs), 4)]:
            if not ANNOUNCER.send_message(): break # stop if cancel sent by client
            msg = format_sse(data=word, model_tag=model_tag, model_name=model_name)
            time.sleep(0.05)
            ANNOUNCER.announce(msg) # send message out to all listeners

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[COMPLETED]"
        ))
    except Exception as e:
        print("Error: ", e)
        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data=f"[ERROR] {e}"
        ))

def local_completion(model_name, model_tag, parameters, prompt, uuid):
    try:
        global ANNOUNCER

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[INITIALIZING]"
        ))
        MODEL, TOKENIZER = load_model(model_name.removeprefix("textgeneration:"))

        # set up stop sequences
        stopping_criteria = None
        stop_sequences = parameters['stop']
        if stop_sequences:
            stop_words_ids = [TOKENIZER.encode(stop_word) for stop_word in stop_sequences]
            stopping_criteria = StoppingCriteriaList([StoppingCriteriaSub(stops=stop_words_ids)])
        print(stopping_criteria)
        # set up inputs and tokenize
        inputs_str = prompt.strip()
        inputs = TOKENIZER(inputs_str, return_tensors="pt")
        input_ids = inputs['input_ids'].to(DEVICE)
        attention_mask = inputs['attention_mask'].to(DEVICE)
        # generate outputs

        outputs = MODEL.generate(inputs=input_ids, 
            attention_mask=attention_mask, 
            max_new_tokens=parameters['maximum_length'], # max length of sequence
            temperature=parameters['temperature'], # randomness of model
            top_k=parameters['top_k'], # top k sampling
            top_p=parameters['top_p'], # top p sampling
            repetition_penalty=parameters['repetition_penalty'], # penalty for repeating words
            output_scores=True, 
            early_stopping=False,
            stopping_criteria=stopping_criteria if stopping_criteria else None,
        )

        curr_token = ""
        sentence = ""
        first_token = True
        for output in outputs:
            if len(output.size()) > 1: continue # skip the last generated full array
            if not ANNOUNCER.send_message(): break # stop if cancel sent by client
            curr = TOKENIZER.convert_ids_to_tokens(output[0], skip_special_tokens=True)
            if (curr):
                curr = curr[0] # string with special character potentially
                time.sleep(0.05) # keep it consistent across models
                if (curr[0] == "Ġ"): # BPE tokenizer
                    # dispatch old token because we have a new one
                    curr_token = curr_token.replace("Ċ", "\n")
                    sentence += curr_token # we can yield here/print here
                    msg = format_sse(data=curr_token, model_tag=model_tag, model_name=model_name)
                    ANNOUNCER.announce(msg) # send message out to all listeners
                    # BPE
                    curr_token = curr.replace("Ġ", " ")
                elif (curr[0] == "▁"): # sentence piece tokenizer
                    # dispatch old token because we have a new one
                    sentence += curr_token # we can yield here/print here
                    msg = format_sse(data=curr_token, model_tag=model_tag, model_name=model_name)
                    ANNOUNCER.announce(msg) # send message out to all listeners
                    if first_token:
                        curr_token = curr.replace("▁", "")
                        first_token = False
                    else:
                        curr_token = curr.replace("▁", " ")
                else:
                    # append to previous token
                    curr_token += curr

        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data="[COMPLETED]"
        ))
    except RuntimeError as e:
        error_message = str(e)
        if "CUDA out of memory" in str(e):
            error_message = "CUDA out of memory"
            print(e)
            
        ANNOUNCER.announce(format_sse(   
             model_tag=model_tag,
            model_name=model_name,
            data=f"[ERROR] {error_message}"
        ))
    except Exception as e:
        ANNOUNCER.announce(format_sse(   
            model_tag=model_tag,
            model_name=model_name,
            data=f"[ERROR] {e}"
        ))
        print(e)
    finally:
        gc.collect()
        torch.cuda.empty_cache()

def bulk_completion(tasks, prompt, uuid):
    global ANNOUNCER
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = []

        for (completion_function, model, tag, params) in tasks:
            if completion_function == local_completion:
                local_completion(model, tag, params, prompt, uuid)
            else:
                futures.append(executor.submit(completion_function, (model, tag, params), prompt, uuid))

        results =  [future.result() for future in futures]
        return results
        
@app.route('/api/compare', methods=['POST'])
def compare():
    global ANNOUNCER
    data = request.get_json(force=True)
    print(data)
    uuid   = data['uuid']
    prompt = data['prompt']
    models = data['models']
    models_by_type = {
        "openai": [],
        "cohere": [],
        "huggingface": [],
        "textgeneration": []
    }

    for model in models:
        name = model['name']
        tag  = model['tag']
        parameters = model['parameters']
        if name.startswith("openai"):
            models_by_type['openai'].append((name, tag, parameters))
        elif name.startswith("cohere"):
            models_by_type['cohere'].append((name, tag, parameters))
        elif name.startswith("huggingface"):
            models_by_type['huggingface'].append((name, tag, parameters))
        elif name.startswith("textgeneration"):
            models_by_type['textgeneration'].append((name, tag, parameters))

    all_tasks = []

    for name, tag, parameters in models_by_type['openai']:
        sanitized_params = {k: parameters[k] for k in ["temperature", "top_p" ]} # "stop"
        sanitized_params['max_tokens'] = parameters['maximum_length']

        all_tasks.append((open_ai_completion, name, tag, sanitized_params))

    for name, tag, parameters in models_by_type['huggingface']:
        sanitized_params = {k: parameters[k] for k in ["temperature", "top_p", "top_k" , "repetition_penalty"]}
        sanitized_params['max_length'] = parameters['maximum_length']

        all_tasks.append((huggingface_completion, name, tag, sanitized_params))

    for name, tag, parameters in models_by_type['cohere']:
        sanitized_params = {k: parameters[k] for k in ["temperature", "presence_penalty", "frequency_penalty", "stop_sequences"]}
        sanitized_params['max_tokens'] = parameters['maximum_length']
        sanitized_params['p'] = parameters['top_p']
        sanitized_params['k'] = parameters['top_k']

        all_tasks.append((cohere_completion, name, tag, sanitized_params))
    
    for name, tag, parameters in models_by_type['textgeneration']:
        sanitized_params = {k: parameters[k] for k in ["temperature", "top_p", "top_k" , "repetition_penalty", "maximum_length"]}
        sanitized_params['stop'] = parameters['stop_sequences']
        all_tasks.append((local_completion, name, tag, sanitized_params))

    if len(all_tasks) > 0: bulk_completion(all_tasks, prompt, uuid)


    if ANNOUNCER.send_message():
        ANNOUNCER.announce("[DONE]")

    response = jsonify({})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/models_defaults', methods=['POST'])
def models_defaults():
    data = request.get_json(force=True)
    print(data)
    models = data['models']
    models_defaults = {}
    response = {}

    #change this later so that its kept in memory
    with open('models_optimal_defaults.json') as json_file:
        models_defaults = json.load(json_file)

    for model in models:
        if model not in models_defaults:
            response[model] = models_defaults["DEFAULT"]
        else:
            response[model] = models_defaults[model]

    response = jsonify(response)
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=1235, debug=True, threaded=True)