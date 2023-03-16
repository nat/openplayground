import os
import transformers
import psutil
import torch
import importlib
import gc
import warnings

from transformers import AutoTokenizer, AutoConfig, PreTrainedModel, PreTrainedTokenizer, StoppingCriteria, StoppingCriteriaList
from .generator import greedy_search_generator
from .helpers import StoppingCriteriaSub

# monkey patch for transformers
transformers.generation.utils.GenerationMixin.greedy_search = greedy_search_generator
os.environ['TOKENIZERS_PARALLELISM'] = 'true'

# Set constants
MODULE = importlib.import_module("transformers") # dynamic import of module class, AutoModel not good enough for text generation
DEVICE = "cuda" if torch.cuda.is_available() else "cpu" # suport gpu inference if possible
MODEL_NAME =  "gpt2" # model name - default to gpt2
MODEL = None # model class
TOKENIZER = None # tokenize class

class HFInference:
    '''
    Class for huggingface local inference
    '''
    def __init__(self, model_name: str):
        self.model_name = model_name
        self.model, self.tokenizer = self.load_model(model_name)

    # Helper function to load model from transformers library
    def load_model(self, model_name: str)-> tuple([PreTrainedModel, PreTrainedTokenizer]):
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

    def generate(self, 
            prompt: str, 
            max_length: int, 
            temperature: float, 
            top_k: int, 
            top_p: float, 
            repetition_penalty: float, 
            stop_sequences: list = None,
            **kwargs
        ):
        '''
        Generate text from prompt
        '''
        # set stopping criteria
        # TODO: bring back when frontend sends it over
        # stopping_criteria = StoppingCriteriaList()
        # if stop_token is not None:
        #     stopping_criteria.append(StoppingCriteria(stop_token))
        # # set up inputs and tokenize
        # stopping_criteria = None
        # stop_sequences = stop_sequences
        # if stop_sequences:
        #     stop_words_ids = [self.tokenizer.encode(stop_word) for stop_word in stop_sequences]
        #     stopping_criteria = StoppingCriteriaList([StoppingCriteriaSub(stops=stop_words_ids)])
        # print(stopping_criteria)
        # set up inputs and tokenize
        inputs_str = prompt.strip()
        inputs = self.tokenizer(inputs_str, return_tensors="pt")
        input_ids = inputs['input_ids'].to(DEVICE)
        attention_mask = inputs['attention_mask'].to(DEVICE)
        # generate outputs
        try:
            outputs = self.model.generate(inputs=input_ids, 
                attention_mask=attention_mask, 
                max_new_tokens=max_length, # max length of sequence
                temperature=temperature, # randomness of model
                top_k=top_k, # top k sampling
                top_p=top_p, # top p sampling
                repetition_penalty=repetition_penalty, # penalty for repeating words
                early_stopping=False,
                # stopping_criteria=stopping_criteria if stopping_criteria else None,
            )
        except Exception as e:
            raise Exception(f"Error generating text: {e}")
        
        curr_token = ""
        sentence = "<|endoftext|>"
        first_token = True
        for output in outputs:
            next_token = output
            if len(next_token.size()) > 1: continue # skip the last generated full array
            curr = self.tokenizer.convert_ids_to_tokens(next_token, skip_special_tokens=True)
        
            if (curr):
                curr = curr[0] # string with special character potentially
                if (curr[0] == "Ġ"): # BPE tokenizer
                    # dispatch old token because we have a new one
                    curr_token = curr_token.replace("Ċ", "\n")
                    curr_token = curr.replace("Ġ", " ")
                    sentence += curr_token # we can yield here/print here
                    yield curr_token
                    # BPE
                elif (curr[0] == "▁"): # sentence piece tokenizer
                    # dispatch old token because we have a new one
                    if first_token:
                        curr_token = curr.replace("▁", "")
                        first_token = False
                    else:
                        curr_token = curr.replace("▁", " ")
                    sentence += curr_token # we can yield here/print here
                    yield curr_token
                else:
                    # append to previous token
                    curr_token = curr
                    curr_token = curr_token.replace("Ċ", "\n")
                    yield curr_token
                    print(f'CURR: {curr}')
                    sentence += curr_token
                
                curr_token = ""

            # dispatch last token, if we can
            if curr_token != "": 
                yield curr_token # send only if non empty
           