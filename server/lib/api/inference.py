import logging
import json
import time
import threading

from .response_utils import create_response_message
from ..inference import InferenceRequest, InferenceResult, InferenceRequest
from ..sse import Message

from concurrent.futures import ThreadPoolExecutor
from flask import g, request, Response, stream_with_context, Blueprint, current_app
from typing import List, Tuple

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

inference_bp = Blueprint('inference', __name__, url_prefix='/inference')

@inference_bp.before_app_request
def set_app_context():
    g.app = current_app

@inference_bp.route("/text/stream", methods=["POST"])
def stream_inference():
    data = request.get_json(force=True)
    logger.info(f"Path: {request.path}, Request: {data}")

    storage = g.get('storage')
    global_state = g.get('global_state')

    if not is_valid_request_data(data):
        return create_response_message("Invalid request", 400)

    request_uuid = "1"
    prompt = data['prompt']
    models = data['models']
    all_tasks = [task for task in (create_inference_request(model, storage, prompt, request_uuid) for model in models) if task is not None]

    if not all_tasks:
        return create_response_message("Invalid Request", 400)

    thread = threading.Thread(target=bulk_completions, args=(global_state, all_tasks,))
    thread.start()

    return stream_response(global_state, request_uuid)

def is_valid_request_data(data):
    return isinstance(data['prompt'], str) and isinstance(data['models'], list)

def create_inference_request(model, storage, prompt, request_uuid):
    model_name, provider_name, model_tag, parameters, model_endpoint = extract_model_data(model)

    model_name = model_name.removeprefix(f"{provider_name}:")
    provider = next((provider for provider in storage.get_providers() if provider.name == provider_name), None)
    
    if provider_name == "truefoundry":
        return InferenceRequest(uuid=request_uuid, model_name=model_name, model_tag=model_tag,
            model_provider=provider_name, model_parameters=parameters, prompt=prompt, model_endpoint=model_endpoint
        )
    if provider is None or not provider.has_model(model_name):
        return None
    
    if validate_parameters(provider.get_model(model_name), parameters):
        return InferenceRequest(uuid=request_uuid, model_name=model_name, model_tag=model_tag,
            model_provider=provider_name, model_parameters=parameters, prompt=prompt, model_endpoint=model_endpoint
        )

    return None

def extract_model_data(model):
    return model['name'],  model['provider'], model['tag'], model['parameters'], model.get("model_endpoint", None)

def validate_parameters(model, parameters):
    default_parameters = model.parameters
    for parameter in parameters:
        if parameter not in default_parameters:
            return False

        value = parameters[parameter]
        parameter_range = default_parameters[parameter]["range"]

        if len(parameter_range) == 2:
            if value < parameter_range[0] or value > parameter_range[1]:
                return False
    return True

def stream_response(global_state, uuid):
    @stream_with_context
    def generator():
        SSE_MANAGER = global_state.get_sse_manager()
        messages = SSE_MANAGER.listen("inferences")
        try:
            while True:
                message = json.loads(message := messages.get())
                if message["type"] == "done":
                    logger.info("Done streaming SSE")
                    break
                logger.debug(f"Yielding message: {json.dumps(message)}")
                yield str(Message(**message))
        except GeneratorExit:
            logger.info("GeneratorExit")
            SSE_MANAGER.publish("inferences", message=json.dumps({"uuid": uuid}))

    return Response(stream_with_context(generator()), mimetype='text/event-stream')

def bulk_completions(global_state, tasks: List[InferenceRequest]):
    time.sleep(1)
    local_tasks, remote_tasks = split_tasks_by_provider(tasks)

    if remote_tasks:
        with ThreadPoolExecutor(max_workers=len(remote_tasks)) as executor:
            futures = [executor.submit(global_state.text_generation, task) for task in remote_tasks]
            [future.result() for future in futures]

    for task in local_tasks:
        global_state.text_generation(task)

    global_state.get_announcer().announce(InferenceResult(
        uuid=tasks[0].uuid,
        model_name=None,
        model_tag=None,
        model_provider=None,
        token=None,
        probability=None,
        top_n_distribution=None
    ), event="done")

def split_tasks_by_provider(tasks: List[InferenceRequest]) -> Tuple[List[InferenceRequest], List[InferenceRequest]]:
    local_tasks, remote_tasks = [], []

    for task in tasks:
        (local_tasks if task.model_provider == "huggingface-local" else remote_tasks).append(task)

    return local_tasks, remote_tasks