import os
import importlib.resources as pkg_resources
import json
import logging

from .event_emitter import EventEmitter, EVENTS
from .entities import Model, Provider
from dotenv import set_key, load_dotenv
from typing import List, Dict, Any

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

config_dir = os.environ.get('XDG_CONFIG_HOME')
if not config_dir:
    if os.name == 'nt':  # Windows
        config_dir = os.environ.get('APPDATA')
    else:  # Linux/Unix
        config_dir = os.path.expanduser('~/.config')

APP_DIR = os.path.join(config_dir, 'openplayground')
os.makedirs(APP_DIR, exist_ok=True)

#TODO in dev it's easier if we keep replacing the file
# Need to add a dev check
if not os.path.exists(os.path.join(APP_DIR, 'models.json')):
    #check if pkg_resources is available

    if not pkg_resources.is_resource('server', 'models.json'):
        print("Reading file from local folder")
        models_json = open('./models.json').read()
    else:
        print("Read file from package")
        models_json = pkg_resources.read_text('server', 'models.json')
    
    with open(os.path.join(APP_DIR, 'models.json'), 'w') as f:
        f.write(models_json)

class Storage:
    def __init__(self, models_json_path: str = None, env_file_path: str = None):
        self.event_emitter = EventEmitter()
        self.providers = []
        self.models = []
        self.models_json_path = models_json_path
        self.env_file_path = env_file_path

        if models_json_path is None:
            self.models_json_path = os.path.join(APP_DIR, 'models.json')
        else:
            self.models_json_path = models_json_path
            
        if env_file_path is None:
            self.env_file_path = os.path.join(os.getcwd(), 'env')
        else:
            load_dotenv(env_file_path)
        
        with open(self.models_json_path, 'r') as f:
            self.models_json = json.load(f)

        for provider_name, provider in self.models_json.items():
            models = []
            for model_name, model in provider['models'].items():
                models.append(
                    Model(
                        model_name,
                        model['enabled'],
                        provider_name,
                        model['status'],
                        model['parameters'],
                    )
                )

            self.providers.append(
                Provider(
                    provider_name,
                    models,
                    provider.get('remoteInference', None),
                    provider.get('defaultParameters', None),
                    os.environ.get(provider_name.upper() + '_API_KEY'),
                    provider['requiresAPIKey'],
                    search_url=provider.get('searchURL', None)
                )
            )
            
            self.models.extend(models)

        for event in [
            EVENTS.MODEL_ADDED,
            EVENTS.MODEL_REMOVED,
            EVENTS.MODEL_STATUS_UPDATE,
            EVENTS.MODEL_UPDATED,
            EVENTS.PROVIDER_API_KEY_UPDATE,
        ]:
            EventEmitter().on(event, self.__update___)

    def get_models(self) -> List[Model]:
        return self.models
    
    def get_enabled_models(self) -> List[Model]:
        return [model for model in self.models if model.enabled]
    
    def get_enabled_models_names(self) -> List[str]:
        return [model.name for model in self.models if model.enabled]

    def get_enabled_models_by_provider(self) -> Dict[str, List[Model]]:
        models_by_provider = {}
        for model in self.models:
            if model.enabled:
                if model.provider not in models_by_provider:
                    models_by_provider[model.provider] = []
                models_by_provider[model.provider].append(model)
        return models_by_provider
    
    def get_model(self, model_name: str) -> Model:
        for model in self.models:
            if model.name == model_name:
                return model
        return None
    
    def get_providers(self) -> List[Provider]:
        return self.providers
    
    def get_provider_names(self) -> List[str]:
        return [provider.name for provider in self.providers]
    
    def get_provider(self, provider_name: str) -> Provider:
        for provider in self.providers:
            if provider.name == provider_name:
                return provider
        return None
    
    def update_provider_api_key(self, provider_name: str, api_key: str):
        provider = self.get_provider(provider_name)
        if provider is None:
            raise ValueError(f'Provider {provider_name} not found')
        provider.api_key = api_key

        if not os.path.exists(self.env_file_path):
            open(self.env_file_path, 'a').close()
        
        set_key(self.env_file_path, provider_name.upper() + '_API_KEY', api_key)
        load_dotenv(self.env_file_path)

        self.event_emitter.emit(EVENTS.PROVIDER_API_KEY_UPDATE, provider_name)
    
    def __update___(self, event: str, *args, **kwargs):
        print(f"Updating models.json file due to {event}")
        self.__save__()

    def update_model(self, model_name: str, model: Model):
        for i, m in enumerate(self.models):
            if m.name == model_name:
                self.models[i] = model
                break

        for provider in self.providers:
            if provider.name == model.provider:
                for i, m in enumerate(provider.models):
                    if m.name == model_name:
                        provider.models[i] = model
                        break              
                break
        print("Emitting model updated event")
        self.event_emitter.emit(EVENTS.MODEL_UPDATED, model)

    def __save__(self):
        '''
        Saves the models.json file
        '''
        print("Saving file to disk")
        logger.info('Saving models.json')
        new_json = {}
        for provider in self.providers:
            new_json[provider.name] = {
                'models': {
                    model.name: {
                        'enabled': model.enabled,
                        'status': model.status,
                        'parameters': model.parameters,
                    }
                    for model in provider.models
                },
                'requiresAPIKey': provider.requires_api_key,
                'remoteInference': provider.remote_inference,
                'defaultParameters': provider.default_parameters,
                'searchURL': provider.search_url,
            }

        with open(self.models_json_path, 'w') as f:
            json.dump(new_json, f, indent=4)

        self.event_emitter.emit(EVENTS.SAVED_TO_DISK)