import logging
import json
from os import environ

from ..entities import ProviderEncoder, ModelEncoder
from ..sse import Message
from .inference import inference_bp
from .provider import provider_bp
from flask import g, Blueprint, current_app, stream_with_context, Response
from ..auth import token_required
from .tfy_models import get_tfy_models

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

api_bp = Blueprint('api', __name__, url_prefix='/api')
api_bp.register_blueprint(provider_bp)
api_bp.register_blueprint(inference_bp)


@api_bp.after_request
def add_cors_header(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


@api_bp.before_app_request
def set_app_context():
    g.app = current_app


@api_bp.route('/get-config', methods=['GET'])
def get_config():
    return current_app.response_class(
        response=json.dumps(
            {"FUSION_AUTH_URL": environ['FUSION_AUTH_URL'],
                "TENANT_ID": environ['TENANT_ID']}, cls=ModelEncoder,
            indent=4, serialize_as_list=True
        ),
        status=200,
        mimetype='application/json'
    )


@api_bp.route('/models', methods=['GET'])
@token_required
def all_models(current_user):
    '''
    Returns a list of all models
    '''
    logger.info("Getting all models")
    tfy_models = get_tfy_models()

    models_list = g.get('storage').get_models()
    models_list.extend(tfy_models)
    return current_app.response_class(
        response=json.dumps(
            models_list, cls=ModelEncoder, indent=4, serialize_as_list=False
        ),
        status=200,
        mimetype='application/json'
    )


@api_bp.route('/models-enabled-names', methods=['GET'])
@token_required
def enabled_models_names(current_user):
    '''
    Returns a list of enabled models
    '''
    logger.info("Getting enabled models")

    return current_app.response_class(
        response=json.dumps(g.get('storage').get_enabled_models_names()),
        status=200,
        mimetype='application/json'
    )


@api_bp.route('/models-enabled', methods=['GET'])
@token_required
def enabled_models(current_user):
    '''
    Returns a list of enabled models
    '''
    logger.info("Getting enabled models")
    storage = g.get('storage')
    models_list = storage.get_enabled_models()
    models_list.extend(get_tfy_models())
    models_dict = {
        f"{model.provider}:{model.name}": model for model in models_list}

    return current_app.response_class(
        response=json.dumps(models_dict, cls=ModelEncoder,
                            indent=4, serialize_as_list=True),
        status=200,
        mimetype='application/json'
    )


@api_bp.route('/providers-list', methods=['GET'])
@token_required
def providers(current_user):
    '''
    Returns a list of providers
    '''
    logger.info("Getting providers")
    storage = g.get('storage')

    return current_app.response_class(
        response=json.dumps(storage.get_providers_names()),
        status=200,
        mimetype='application/json'
    )


@api_bp.route('/providers-with-key-and-models', methods=['GET'])
@token_required
def providers_with_models(current_user):
    '''
    Returns a list of providers with their models and API keys
    '''
    logger.info("Getting providers with models")
    storage = g.get('storage')

    providers_list = storage.get_providers()
    providers_dict = {provider.name: provider for provider in providers_list}

    return current_app.response_class(
        response=json.dumps(
            providers_dict, cls=ProviderEncoder, indent=4, serialize_models_as_list=True
        ),
        status=200,
        mimetype='application/json'
    )


@api_bp.route('/providers-check-keys', methods=['GET'])
@token_required
def providers_check_api_keys(current_user):
    '''
    Checks all the API keys stored in the .env file - matches against the providers in models.json
    Model must have "api_key" field set to true in models.json, otherwise "None" is returned
    Keys are stored in .env in {PROVIDER}_API_KEY format
    '''
    logger.info("Checking API key store")
    storage = g.get('storage')

    return current_app.response_class(
        response=json.dumps(storage.get_providers_keys()),
        status=200,
        mimetype='application/json'
    )


@api_bp.route("/notifications", methods=['GET'])
@token_required
def notifications(current_user):
    '''
    Notifies the client when a model has been successfully downloaded
    '''
    logger.info("Received notification request")

    global_state = g.get('global_state')
    request_uuid = "1"

    @stream_with_context
    def generator():
        SSE_MANAGER = global_state.get_sse_manager()

        messages = SSE_MANAGER.listen("notifications")
        try:
            while True:
                message = messages.get()
                message = json.loads(message)
                if message["type"] == "done":
                    logger.info("Done streaming SSE")
                    break
                print("Sending message: ", message)
                logger.info(f"Yielding message: {message}")
                yield str(Message(**message))
        except GeneratorExit:
            logger.info("GeneratorExit")

    return Response(stream_with_context(generator()), mimetype='text/event-stream')
