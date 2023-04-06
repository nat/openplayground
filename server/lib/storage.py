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

class Storage:
    def __init__(self, models_json_path: str = None, env_file_path: str = None):
        self.event_emitter = EventEmitter()
        self.providers = []
        self.models = []
        self.models_json, self.models_json_path = self.__initialize_config__(models_json_path)
        self.env_file_path = env_file_path

        if env_file_path is None:
            self.env_file_path = os.path.join(os.getcwd(), 'env')
        elif os.path.exists(env_file_path):
            load_dotenv(env_file_path)

        for provider_name, provider in self.models_json.items():
            models = [
                Model(
                    name=model_name,
                    provider=provider_name,
                    capabilities=model.get("capabilities", []),
                    enabled=model.get("enabled", False),
                    status=model.get("status", "ready"),
                    parameters=model.get("parameters", {})
                )
                for model_name, model in provider['models'].items()
            ]
            self.providers.append(
                Provider(
                    name=provider_name,
                    models=models,
                    remote_inference=provider.get('remoteInference', None),
                    default_capabilities=provider.get('defaultCapabilities', []),
                    default_parameters=provider.get('defaultParameters', None),
                    api_key=os.environ.get(f'{provider_name.upper()}_API_KEY'),
                    requires_api_key=provider.get("requiresAPIKey", False),
                    search_url=provider.get('searchURL', None),
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

    def __initialize_config__(self, models_json_path: str = None):
        if models_json_path is None:
            models_json_path = os.path.join(APP_DIR, 'models.json')

        original_models_json = None
        if not pkg_resources.is_resource('server', 'models.json'):
            original_models_json = open('./models.json').read()
        else:
            original_models_json = pkg_resources.read_text('server', 'models.json')

        if not os.path.exists(os.path.join(APP_DIR, 'models.json')):
            with open(os.path.join(APP_DIR, 'models.json'), 'w') as f:
                f.write(original_models_json)
        else:
            original_models_json = json.loads(original_models_json)

            with open(os.path.join(APP_DIR, 'models.json'), 'r') as f:
                cached_models_json = json.load(f)
 
                cached_providers = cached_models_json.keys()
                original_providers = original_models_json.keys()

                provider_in_original_not_cache = [provider for provider in original_providers if provider not in cached_providers]

                for provider in provider_in_original_not_cache:
                    cached_models_json[provider] = original_models_json[provider]
                
                cached_providers = cached_models_json.keys()

                for cached_provider in cached_providers:
                    cached_provider_keys = cached_models_json[cached_provider].keys()
                    original_provider_keys = original_models_json[cached_provider].keys()

                    #keys in cache but not in original
                    cache_keys_missing = [key for key in cached_provider_keys if key not in original_provider_keys]
                    #keys in original but not in cache
                    missing_original_keys = [key for key in original_provider_keys if key not in cached_provider_keys]

                    for missing_cached_key in cache_keys_missing:
                        del cached_models_json[cached_provider][missing_cached_key]

                    for missing_original_key in missing_original_keys:
                        cached_models_json[cached_provider][missing_original_key] = original_models_json[cached_provider][missing_original_key]

                    cached_provider_models = cached_models_json[cached_provider]['models'].keys()
                    original_provider_models = original_models_json[cached_provider]['models'].keys()

                    for cached_model in cached_provider_models:
                        if cached_model not in original_provider_models:
                            continue

                        cached_model_keys = cached_models_json[cached_provider]['models'][cached_model].keys()
                        original_model_keys = original_models_json[cached_provider]['models'][cached_model].keys()

                        for original_model_key in original_model_keys:
                            if original_model_key not in cached_model_keys:
                                cached_models_json[cached_provider]['models'][cached_model][original_model_key] = original_models_json[cached_provider]['models'][cached_model][original_model_key]

        with open(models_json_path, 'r') as f:
            return json.load(f), models_json_path

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
        return next((model for model in self.models if model.name == model_name), None)
    
    def get_providers(self) -> List[Provider]:
        return self.providers
    
    def get_provider_names(self) -> List[str]:
        return [provider.name for provider in self.providers]
    
    def get_provider(self, provider_name: str) -> Provider:
        return next(
            (
                provider
                for provider in self.providers
                if provider.name == provider_name
            ),
            None,
        )
    
    def update_provider_api_key(self, provider_name: str, api_key: str):
        provider = self.get_provider(provider_name)
        if provider is None:
            raise ValueError(f'Provider {provider_name} not found')
        provider.api_key = api_key

        if not os.path.exists(self.env_file_path):
            open(self.env_file_path, 'a').close()

        set_key(self.env_file_path, f'{provider_name.upper()}_API_KEY', api_key)
        load_dotenv(self.env_file_path)

        self.event_emitter.emit(EVENTS.PROVIDER_API_KEY_UPDATE, provider_name)
    
    def __update___(self, event: str, *args, **kwargs):
        if event == EVENTS.MODEL_ADDED:
            model = args[0]
            self.models.append(model)
        elif event == EVENTS.MODEL_REMOVED:
            model = args[0]
            self.models.remove(model)
       
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
        self.event_emitter.emit(EVENTS.MODEL_UPDATED, model)

    def __save__(self):
        '''
        Saves the models.json file
        '''
        logger.info('Saving models.json')
        new_json = {
            provider.name: {
                'models': {
                    model.name: {
                        'capabilities': model.capabilities,
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
            for provider in self.providers
        }
        with open(self.models_json_path, 'w') as f:
            json.dump(new_json, f, indent=4)

        self.event_emitter.emit(EVENTS.SAVED_TO_DISK)

    def import_config(config_path: str):
        '''
        Imports the models.json file from the specified path
        '''
        if not os.path.exists(config_path):
            raise FileNotFoundError(f'{config_path} not found')
        
        with open(config_path, 'r') as f:
            with open(os.path.join(APP_DIR, 'models.json'), 'w') as f2:
                f2.write(f.read())

    def export_config(output_path: str):
        '''
        Exports the models.json file to the specified path
        '''
        if not os.path.exists(os.path.join(APP_DIR, 'models.json')):
            raise FileNotFoundError('models.json not found')
        
        with open(os.path.join(APP_DIR, 'models.json'), 'r') as f:
            with open(output_path, 'w') as f2:
                f2.write(f.read())