import os
import transformers
import psutil
import torch
import importlib
import gc
import warnings

from transformers import AutoTokenizer, AutoConfig, PreTrainedModel, PreTrainedTokenizer, StoppingCriteria, StoppingCriteriaList
from huggingface_hub import hf_hub_download, try_to_load_from_cache, scan_cache_dir, _CACHED_NO_EXIST
from dotenv import load_dotenv, set_key, unset_key, find_dotenv
from generator import greedy_search_generator

# monkey patch for transformers
transformers.generation.utils.GenerationMixin.greedy_search = greedy_search_generator
os.environ['TOKENIZERS_PARALLELISM'] = 'true'

# Set constants
MODULE = importlib.import_module("transformers") # dynamic import of module class, AutoModel not good enough for text generation
DEVICE = "cuda" if torch.cuda.is_available() else "cpu" # suport gpu inference if possible
MODEL_NAME =  "gpt2" # model name - default to gpt2
MODEL = None # model class
TOKENIZER = None # tokenize class

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
