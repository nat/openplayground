import json
import math
import torch

def format_sse(data: str, prob=None, event=None, model_tag=None, model_name=None) -> str:
    encode = {}
    encode["message"] = data
    if model_name is not None:
        encode["model_name"] = model_name
    if model_tag is not None:
        encode["model_tag"] = model_tag
    if prob is not None:
        # TODO: this might break compare probabilities
        encode["prob"] = json.dumps(prob)
    data = json.dumps(encode)
    msg = f"data:{data}\n\n"
    if event is not None:
        msg = f'event: {event}\n{msg}'
    return msg

def format_token_probabilities(likelihood: dict, chosen_token: str = None, model_tag: str = None) -> dict:
    '''
    Takes tokens and their log probabilities and formats it into a sorted dictionary mapping of 
    token --> [log probability, simple probability]
    '''
    # just for extensibility sake, providers may look different in future
    if model_tag == "openai":
        token_probabilities = {}
        chosen_log_prob = 0
        simple_prob_sum = 0
        for token, log_prob in likelihood.items():
            simple_prob = round(math.exp(log_prob) * 100, 2)
            token_probabilities[token] = [log_prob, simple_prob]
            if token == chosen_token:
                chosen_log_prob = round(log_prob, 2)
            simple_prob_sum += simple_prob
        sorted_token_probabilities = dict(sorted(token_probabilities.items(), key=lambda item: item[1][0], reverse=True))
        total_dict = {"log_prob_sum" : chosen_log_prob, "simple_prob_sum" : round(simple_prob_sum, 2)}
        return_dict  = {"tokens" : sorted_token_probabilities, "total" : total_dict}
        return return_dict
    elif model_tag == "cohere":
        token_probabilities = {}
        log_prob = likelihood['likelihood']
        print(f'log_prob: {log_prob}')
        simple_prob = round(math.exp(log_prob) * 100, 2)
        token_probabilities[chosen_token] = [log_prob, simple_prob]
        total_dict = {"log_prob_sum" : None, "simple_prob_sum" : None} # we don't get those so we just leave them null
        return_dict  = {"tokens" : token_probabilities, "total" : total_dict}
        return return_dict
    elif model_tag == "hf_local":
        token_probabilities = {}
        log_prob = likelihood['logprob']
        simple_prob = round(math.exp(log_prob) * 100, 2)
        token_probabilities[chosen_token] = [log_prob, simple_prob]
        total_dict = {"log_prob_sum" : None, "simple_prob_sum" : None} # we don't get those so we just leave them null
        return_dict  = {"tokens" : token_probabilities, "total" : total_dict}
        return return_dict
    elif model_tag is None:
        raise ValueError("model_tag must be specified")

def get_num_tokens(text, tokenizer):
    return len(tokenizer(text, return_tensors="pt")['input_ids'][0])