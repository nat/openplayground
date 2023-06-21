from flask import g
import requests
from ..entities import Model, Provider
from urllib.parse import urljoin

from urllib.parse import urljoin

def get_text_generation_models(url, token, default_params={}):
    '''
    Returns a list of all text generation models
    '''
    resp = requests.get(
        urljoin(url, 'api/svc/v1/app?applicationType=model-deployment'),
        headers={
            'Authorization': f'Bearer {token}'
        }
    )
    resp.raise_for_status()
    raw_models = resp.json()
    models_list = []
    for model in raw_models:
        model_endpoint = None
        host = model["deployment"]["manifest"]["endpoint"].get("host", None)
        path = model["deployment"]["manifest"]["endpoint"].get("path", None)
        if host:
            model_endpoint = f'https://{host}'
            if path:
                path = path.lstrip('/')
                if not path.endswith('/'):
                    path += '/'
                model_endpoint = urljoin(model_endpoint, path)

        if model["deployment"]["manifest"]["replicas"] > 0 and model_endpoint is not None:
            models_list.append(
                Model(
                    name=model['name'],
                    provider="truefoundry",
                    enabled=True,
                    status="ready",
                    parameters=default_params,
                    model_endpoint=model_endpoint,
                    capabilities=[]
                )
            )
    return models_list
        

def get_tfy_models():
    '''
    Returns a list of all TFY models
    '''
    provider = g.get('storage').get_provider('truefoundry')
    if provider is None:
        return []
    
    tfy_models = get_text_generation_models(provider.search_url, provider.api_key, provider.default_parameters)
    return tfy_models