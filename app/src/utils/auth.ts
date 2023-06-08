import "crypto"
import axios from "axios"
import Cookies from "js-cookie"
import jsCookie from "js-cookie"

export function IsLoggedIn() {
  const accessToken = jsCookie.get("accessToken")
  return !!accessToken
}

export function getAccessToken() {
  const accessToken = jsCookie.get("accessToken")
  return accessToken
}

export const getPathToRedirect = (defaultPath = "/") => {
  const path: string = localStorage.getItem("path_before_signin") || defaultPath
  return path
}

function dec2hex(dec: number) {
  const str = "0" + dec.toString(16)
  return str.substring(str.length - 2)
}

function generateRandomString(): string {
  const array = new Uint32Array(56 / 2)
  crypto.getRandomValues(array)
  return Array.from(array, dec2hex).join("")
}

async function generatePKCE() {
  const codeVerifier = generateRandomString()

  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const sha256 = await crypto.subtle.digest("SHA-256", data)

  let str = ""
  const bytes = new Uint8Array(sha256)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i])
  }

  const codeChallenge = btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return { codeVerifier, codeChallenge }
}

function generateUrl(
  baseURL: string,
  path: string,
  queryParams: Record<string, string>
) {
  const query = new URLSearchParams(queryParams)
  return `${baseURL}${path}?${query}`
}

async function setConfig() {
  const config = await (await fetch("/api/get-config")).json()
  jsCookie.set("oauthURL", config["FUSION_AUTH_URL"])
  jsCookie.set("tenantId", config["TENANT_ID"])
  return { oauthURL: config["FUSION_AUTH_URL"], tenantId: config["TENANT_ID"] }
}

async function getOAuthURL() {
  const oauthURL = jsCookie.get("oauthURL")
  if (oauthURL) {
    return oauthURL
  }
  return (await setConfig()).oauthURL
}

async function getTenantId() {
  const tenantId = jsCookie.get("tenantId")
  if (tenantId) {
    return tenantId
  }
  return (await setConfig()).tenantId
}

export async function beginLoginFlow() {
  const code = await generatePKCE()
  jsCookie.set("codeVerifier", code.codeVerifier)
  const tokenExchangeURL = `${window.location.origin}/auth/callback`
  const baseURL = await getOAuthURL()
  const tenantId = await getTenantId()

  const queryParams = {
    client_id: tenantId,
    response_type: "code",
    redirect_uri: tokenExchangeURL,
    code_challenge: code.codeChallenge,
    code_challenge_method: "S256",
    scope: "openid offline_access",
    state: window.location.origin,
  }
  const fullUrl = generateUrl(baseURL, "/oauth2/authorize", queryParams)
  window.location.replace(fullUrl)
}

export async function finishLoginFlow(code: string) {
  const baseURL = await getOAuthURL()
  const tenantId = await getTenantId()
  const codeVerifier = Cookies.get("codeVerifier")
  const redirectURI = `${window.location.origin}/auth/callback`
  const query = new URLSearchParams({
    client_id: tenantId,
    code: code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectURI,
  } as Record<string, string>)
  const response = await axios.post(`${baseURL}/oauth2/token`, query, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })

  const accessToken = response.data.access_token
  jsCookie.set("accessToken", accessToken)
  const redirectPath = getPathToRedirect()
  localStorage.removeItem("path_before_signin")
  window.location.replace(redirectPath)
}

export async function logoutAll() {
  const baseURL = await getOAuthURL()
  const tenantId = await getTenantId()
  const logoutURL = generateUrl(baseURL, "/oauth2/logout", {
    client_id: tenantId,
    post_logout_redirect_uri: window.location.origin,
  })
  window.location.replace(logoutURL)
}
