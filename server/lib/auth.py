from functools import wraps
import jwt
from jwt import PyJWKClient
from flask import request, abort
from os import environ


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if "Authorization" in request.headers:
            token = request.headers["Authorization"].split(" ")[1]
        if not token:
            return {
                "message": "Authentication Token is missing!",
                "data": None,
                "error": "Unauthorized"
            }, 401
        try:
            fusionAuthURL = environ["FUSION_AUTH_URL"]
            url = fusionAuthURL + "/.well-known/jwks.json"
            jwks_client = PyJWKClient(url)
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            data = jwt.decode(
                token, signing_key.key, algorithms=["RS256"], audience=environ["TENANT_ID"])
            current_user = {
                "id": data.get('sub'),
                "username": data.get('username'),
                "tenant_name": data.get('tenantName'),
                "tenant_id": data.get('applicationId'),
                "email": data.get('email'),
                "roles": data.get('roles')
            }
            if current_user is None:
                return {
                    "message": "Invalid Authentication token!",
                    "data": None,
                    "error": "Unauthorized"
                }, 401
        except Exception as e:
            return {
                "message": "Something went wrong",
                "data": None,
                "error": str(e)
            }, 500

        return f(current_user, *args, **kwargs)

    return decorated
