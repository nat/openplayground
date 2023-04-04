from flask import Response, jsonify

def create_response_message(message: str, status_code: int) -> Response:
    response = jsonify({'status': message})
    response.status_code = status_code
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response