import logging
import json
import requests

from .response_utils import create_response_message
from ..entities import Model, ModelEncoder

from flask import g, request, jsonify, Blueprint, current_app

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

provider_bp = Blueprint('provider', __name__, url_prefix='/provider')

@provider_bp.before_app_request
def set_app_context():
    g.app = current_app
    
@provider_bp.before_request
def verify_provider():
    storage = g.get('storage')
    provider_name = request.view_args.get('provider_name')
    model_name = request.view_args.get('model_name')

    provider = g.provider = storage.get_provider(provider_name)

    if provider is None:
        return create_response_message(f"Invalid provider: {provider_name}", 400)
    
    if not provider.search_url and (model_name and not provider.has_model(model_name)):
        return create_response_message(f"Invalid model: {model_name}", 400)
    
    g.model = provider.get_model(model_name)
       
@provider_bp.route('/<string:provider_name>/models')
def provider_models(provider_name):
    '''
    Route to get models for a given provider
    '''
    logger.info(f"Getting models for provider {provider_name}")

    return current_app.response_class(
        response=json.dumps(g.provider.models, cls=ModelEncoder),
        status=200,
        mimetype='application/json',
        headers={'Access-Control-Allow-Origin': '*'}
    )
       
@provider_bp.route('/<string:provider_name>/model/<string:model_name>')
def provider_model(provider_name, model_name):
    '''
    Route to get model information for a given provider
    '''
    logger.info(f"Getting model {model_name} for provider {provider_name}")

    return current_app.response_class(
        response=json.dumps(g.provider.get_model(model_name), cls=ModelEncoder),
        status=200,
        mimetype='application/json',
        headers={'Access-Control-Allow-Origin': '*'}
    )

@provider_bp.route('/<string:provider_name>/model/<path:model_name>/toggle-status')
def provider_toggle_model(provider_name, model_name):
    logger.info(f"Enabling Provider Model {provider_name}  {model_name}")
    provider = g.provider
    model = g.model

    #if it made it this far then it has to a dynamic model (HF/OpenPlayground Hub)
    if model is None:
        model = Model(
            name=model_name,
            capabilities=provider.default_capabilities,
            provider=provider_name,
            status="ready" if provider.remote_inference else "pending",
            enabled=True,
            parameters=provider.default_parameters
        )
        provider.add_model(model)
    else:
        model.enabled = not model.enabled
        provider.update_model(model.name, model)
    
    return current_app.response_class(
        response=json.dumps({
            'status': 'success',
            'enabled': model.enabled,
            'model': model
        }, cls=ModelEncoder),
        status=200,
        mimetype='application/json'
    )

@provider_bp.route('/<string:provider_name>/models/search')
def provider_models_search(provider_name):
    logger.info(f"Searching Provider Models {provider_name}")
    provider = g.provider

    search_name = request.args.get('query', None)
    if search_name is None:
        return "Missing query parameter", 400
    
    #TODO make this provider agnostic
    search_url = provider.search_url

    if search_url is None:
        return "Search not supported for this provider", 400
    
    search_url = search_url.replace('{searchQuery}', search_name)

    response = requests.get(search_url)
    content_json = response.json()
    models = content_json.get('models', [])
    models = list(map(lambda model: {'name': model['id']}, models))

    return current_app.response_class(
        response=json.dumps(models),
        status=200,
        mimetype='application/json'
    )

@provider_bp.route('/<string:provider_name>/api-key', methods=['PUT'])
def provider_update_api_key(provider_name):
    '''
    Routes to update the API key for a given provider
    '''
    logger.info(f"Storing API key for {provider_name}")

    data = request.get_json(force=True)
    storage = g.get('storage')

    api_key = data['apiKey']
    if api_key is None:
        return create_response_message("Invalid API key", 400)

    storage.update_provider_api_key(provider_name, api_key)

    response = jsonify({'status': 'success'})
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response