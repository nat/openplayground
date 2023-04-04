import logging
import json
import time
import threading

from .response_utils import create_response_message
from ..inference import InferenceRequest, InferenceResult, InferenceRequest
from ..sse import Message

from concurrent.futures import ThreadPoolExecutor
from flask import g, request, Response, stream_with_context, Blueprint, current_app
from typing import List

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

inference_bp = Blueprint('inference', __name__, url_prefix='/inference')

@inference_bp.before_app_request
def set_app_context():
    g.app = current_app

@inference_bp.route("/stream", methods=["POST"])
def stream_inference():
    '''
    Takes in inference request from frontend, checks for valid parameters, and dispatchees to inference queue
    '''
    data = request.get_json(force=True)
    logger.info(f"Path: {request.path}, Request: {data}")

    storage = g.get('storage')
    global_state = g.get('global_state')

    if not isinstance(data['prompt'], str) or not isinstance(data['models'], list):
        return create_response_message("Invalid request", 400)
    
    request_uuid = "1"

    prompt = data['prompt']
    models = data['models']
    providers = storage.get_provider_names()

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
        # TODO: Add parameters range valition from hosted
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
        elif provider == "huggingface-local":
            name = name.removeprefix("huggingface-local:")
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
    
    uuid = "1"

    if len(all_tasks) == 0:
        return create_response_message("Invalid Request", 400)
    
    thread = threading.Thread(target=bulk_completions, args=(global_state, all_tasks,))
    thread.start()

    @stream_with_context
    def generator():
        SSE_MANAGER = global_state.get_sse_manager()

        messages = SSE_MANAGER.listen("inferences")
        try:
            while True:
                message = messages.get()
                message = json.loads(message)
                if message["type"] == "done":
                    logger.info("Done streaming SSE")
                    break
                logger.info(f"Yielding message: {message}")
                yield str(Message(**message))
        except GeneratorExit:
            logger.info("GeneratorExit")
            SSE_MANAGER.publish("inferences", message=json.dumps({"uuid": uuid}))

    return Response(stream_with_context(generator()), mimetype='text/event-stream')

def bulk_completions(global_state, tasks: List[InferenceRequest]):
    time.sleep(1)
    local_tasks = []
    remote_tasks = []
    for task in tasks:
        if task.model_provider == "huggingface-local":
            local_tasks.append(task)
        else:
            remote_tasks.append(task)
    if len(remote_tasks) > 0:
        with ThreadPoolExecutor(max_workers=len(remote_tasks)) as executor:
            futures = []
            for inference_request in remote_tasks:
                futures.append(executor.submit(global_state.text_generation, inference_request))

            [future.result() for future in futures]
    
    #Not safe to assume that localhost can run multiple models at once
    for inference_request in local_tasks:
        global_state.text_generation(inference_request)
        
    global_state.get_announcer().announce(InferenceResult(
        uuid=tasks[0].uuid,
        model_name=None,
        model_tag=None,
        model_provider=None,
        token=None,
        probability=None,
        top_n_distribution=None
    ), event="done")

