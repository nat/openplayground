import anthropic
import cachetools
import math
import openai
import os
import json
import requests
import sseclient
import urllib
import traceback
import logging

from aleph_alpha_client import Client as aleph_client, CompletionRequest, Prompt
from datetime import datetime
from dataclasses import dataclass
from typing import Callable, Union, Optional
from .huggingface.hf import HFInference

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

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
    model_endpoint: Optional[str] = None

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
    def __init__(self, sse_topic):
        self.sse_topic = sse_topic
        self.cancel_cache = cachetools.TTLCache(maxsize=1000, ttl=60)

    def __format_message__(self, event: str, infer_result: InferenceResult) -> str:
        logger.debug("formatting message")
        encoded = {
            "message": infer_result.token,
            "modelName": infer_result.model_name,
            "modelTag": infer_result.model_tag,
            "modelProvider": infer_result.model_provider,
        }

        if infer_result.probability is not None:
            encoded["prob"] = round(math.exp(infer_result.probability) * 100, 2) 

        if infer_result.top_n_distribution is not None:
            encoded["topNDistribution"] = {
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

        logger.debug(f"Announcing {event} for uuid: {infer_result.uuid}, message: {message}")
        self.sse_topic.publish(message)
        return True

    def cancel_callback(self, message):
        if message['type'] == 'pmessage':
            data = json.loads(message['data'])
            uuid = data['uuid']
            logger.info(f"Received cancel message for uuid: {uuid}")
            self.cancel_cache[uuid] = True      
   
class InferenceManager:
    def __init__(self, sse_topic):
        self.announcer = InferenceAnnouncer(sse_topic)

    def __error_handler__(self, inference_fn: InferenceFunction, provider_details: ProviderDetails, inference_request: InferenceRequest):
        logger.info(f"Requesting inference from {inference_request.model_name} on {inference_request.model_provider}")
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
            logger.error(f"OpenAI API request timed out: {e}")
        except openai.error.APIError as e:
            infer_result.token = f"[ERROR] OpenAI API returned an API Error: {e}"
            logger.error(f"OpenAI API returned an API Error: {e}")
        except openai.error.APIConnectionError as e:
            infer_result.token = f"[ERROR] OpenAI API request failed to connect: {e}"
            logger.error(f"OpenAI API request failed to connect: {e}")
        except openai.error.InvalidRequestError as e:
            infer_result.token = f"[ERROR] OpenAI API request was invalid: {e}"
            logger.error(f"OpenAI API request was invalid: {e}")
        except openai.error.AuthenticationError as e:
            infer_result.token = f"[ERROR] OpenAI API request was not authorized: {e}"
            logger.error(f"OpenAI API request was not authorized: {e}")
        except openai.error.PermissionError as e:
            infer_result.token = f"[ERROR] OpenAI API request was not permitted: {e}"
            logger.error(f"OpenAI API request was not permitted: {e}")
        except openai.error.RateLimitError as e:
            infer_result.token = f"[ERROR] OpenAI API request exceeded rate limit: {e}"
            logger.error(f"OpenAI API request exceeded rate limit: {e}")
        except requests.exceptions.RequestException as e:
            logging.error(f"RequestException: {e}")
            infer_result.token = f"[ERROR] No response from {infer_result.model_provider } after sixty seconds"
        except ValueError as e:
            if infer_result.model_provider == "huggingface-local":
                infer_result.token = f"[ERROR] Error parsing response from local inference: {traceback.format_exc()}"
                logger.error(f"Error parsing response from local inference: {traceback.format_exc()}")
            else:
                infer_result.token = f"[ERROR] Error parsing response from API: {e}"
                logger.error(f"Error parsing response from API: {e}")
        except Exception as e:
            infer_result.token = f"[ERROR] {e}"
            logger.error(f"Error: {e}")
        finally:
            if infer_result.token is None:
                infer_result.token = "[COMPLETED]"
            self.announcer.announce(infer_result, event="status")
            logger.info(f"Completed inference for {inference_request.model_name} on {inference_request.model_provider}")
    
    def __openai_chat_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        openai.api_key = provider_details.api_key

        current_date = datetime.now().strftime("%Y-%m-%d")

        if inference_request.model_name == "gpt-4":
            system_content = "You are GPT-4, a large language model trained by OpenAI. Answer as concisely as possible"
        else:
            system_content = f"You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible. Knowledge cutoff: 2021-09-01 Current date: {current_date}"

        response = openai.ChatCompletion.create(
             model=inference_request.model_name,
             messages = [
                {"role": "system", "content": system_content},
                {"role": "user", "content": inference_request.prompt},
            ],
            temperature=inference_request.model_parameters['temperature'],
            max_tokens=inference_request.model_parameters['maximumLength'],
            top_p=inference_request.model_parameters['topP'],
            frequency_penalty=inference_request.model_parameters['frequencyPenalty'],
            presence_penalty=inference_request.model_parameters['presencePenalty'],
            stream=True,
            timeout=60
        )

        tokens = ""
        cancelled = False

        for event in response:
            response = event['choices'][0]
            if response['finish_reason'] == "stop":
                break

            delta = response['delta']

            if "content" not in delta:
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
                cancelled = True
                logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")

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
                cancelled = True
                logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")

    def openai_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        # TODO: Add a meta field to the inference so we know when a model is chat vs text
        if inference_request.model_name in ["gpt-3.5-turbo", "gpt-4"]:
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
                    cancelled = True
                    logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")

    def cohere_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__cohere_text_generation__, provider_details, inference_request)
    
    def __huggingface_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        response = requests.request("POST",
            f"https://api-inference.huggingface.co/models/{inference_request.model_name}",
            headers={"Authorization": f"Bearer {provider_details.api_key}"},
            json={
                "inputs": inference_request.prompt,
                "stream": True,
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

        cancelled = False

        if response.status_code != 200:
            raise Exception(f"Request failed: {response.status_code} {response.reason}")

        if content_type == "application/json":
            return_data = json.loads(response.content.decode("utf-8"))
            outputs = return_data[0]["generated_text"]
            outputs = outputs.removeprefix(inference_request.prompt)

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
            total_tokens = 0
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

                if cancelled: continue

                if not self.announcer.announce(
                    InferenceResult(
                        uuid=inference_request.uuid,
                        model_name=inference_request.model_name,
                        model_tag=inference_request.model_tag,
                        model_provider=inference_request.model_provider,
                        token=" " if token['id'] == 3 else token['text'],
                        probability=token['logprob'],
                        top_n_distribution=None,
                    ),
                    event="infer",
                ):
                    cancelled = True
                    logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")
           
    def huggingface_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__huggingface_text_generation__, provider_details, inference_request)

    def __forefront_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
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
                        cancelled = True
                        logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")
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

                            if token == generated_token:
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
                            cancelled = True
                            logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")

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
        logger.info(f"Starting inference for {inference_request.uuid} - {inference_request.model_name}")

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
                cancelled = True
                logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")

    def local_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
       self.__error_handler__(self.__local_text_generation__, provider_details, inference_request)
    
    def __anthropic_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        c = anthropic.Client(provider_details.api_key)

        response = c.completion_stream(
            prompt=f"{anthropic.HUMAN_PROMPT} {inference_request.prompt}{anthropic.AI_PROMPT}",
            stop_sequences=[anthropic.HUMAN_PROMPT] + inference_request.model_parameters['stopSequences'],
            temperature=float(inference_request.model_parameters['temperature']),
            top_p=float(inference_request.model_parameters['topP']),
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
                logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")

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
        
        self.announcer.announce(InferenceResult(
            uuid=inference_request.uuid,
            model_name=inference_request.model_name,
            model_tag=inference_request.model_tag,
            model_provider=inference_request.model_provider,
            token=response.completions[0].completion,
            probability=None,
            top_n_distribution=None
        ), event="infer")

    def aleph_alpha_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__aleph_alpha_text_generation__, provider_details, inference_request)
    
    def __truefoundry_text_generation__(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        cancelled = False
        logger.info(f"Starting inference for {inference_request.uuid} - {inference_request.model_name}")
        model_endpoint = urllib.parse.urljoin(inference_request.model_endpoint, f'v2/models/{inference_request.model_name}/infer/simple')
        response = requests.post(
            url = model_endpoint,
            json = {
                "inputs": inference_request.prompt,
                "parameters": {
                    "max_new_tokens": int(inference_request.model_parameters['maximumLength']),
                    "top_p": float(inference_request.model_parameters['topP']),
                    "top_k": int(inference_request.model_parameters['topK']),
                    "temperature": float(inference_request.model_parameters['temperature']),
                    "repetition_penalty": float(inference_request.model_parameters['repetitionPenalty']),
                    "return_full_text": False
                }
            }
        )
        response.raise_for_status()
        output = response.json()[0]["generated_text"]
        infer_response = None
        output = output.split(' ')
        for generated_token in output:
            if cancelled: break
            infer_response = InferenceResult(
                uuid=inference_request.uuid,
                model_name=inference_request.model_name,
                model_tag=inference_request.model_tag,
                model_provider=inference_request.model_provider,
                token=' ',
                probability=None,
                top_n_distribution=None
            )
            if not self.announcer.announce(infer_response, event="infer"):
                cancelled = True
                logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")
            
            if cancelled: break
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
                cancelled = True
                logger.info(f"Cancelled inference for {inference_request.uuid} - {inference_request.model_name}")
        self.announcer.announce(InferenceResult(
            uuid=inference_request.uuid,
            model_name=None,
            model_tag=None,
            model_provider=None,
            token=None,
            probability=None,
            top_n_distribution=None
        ), event="done")

    def truefoundry_text_generation(self, provider_details: ProviderDetails, inference_request: InferenceRequest):
        self.__error_handler__(self.__truefoundry_text_generation__, provider_details, inference_request)

    
    def get_announcer(self):
        return self.announcer 