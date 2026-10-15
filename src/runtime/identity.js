import * as oidc from 'openid-client';
import {transaction,digest,token,HttpError} from './database.js';

export function cookieValue(req,name){return (req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);}
export function sessionStore(pool,{secure=true}={}){
  const cookieName=secure?'__Host-tdsa-session':'tdsa-preview-session';
  const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
  return {
    async create(principalId,expiresAt){
      const value=token(),csrf=token();const expiry=new Date(Math.min(new Date(expiresAt).getTime(),Date.now()+60*60*1000));
      if(!Number.isFinite(expiry.getTime())||expiry<=new Date())throw new HttpError(401,'Sign-in has expired');
      await transaction(pool,async c=>{await c.query('DELETE FROM hub_identity.sessions WHERE expires_at<=now()');await c.query('INSERT INTO hub_identity.sessions(token_hash,principal_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)',[digest(value),principalId,csrf,expiry]);});
      return cookie(value,Math.floor((expiry.getTime()-Date.now())/1000));
    },
    async resolve(req){
      const value=cookieValue(req,cookieName);if(!value||value.length>100)throw new HttpError(401,'Please sign in');
      return transaction(pool,async c=>{
        const {rows:[s]}=await c.query(`SELECT s.principal_id,s.csrf_token,s.expires_at,p.display_name FROM hub_identity.sessions s JOIN hub_identity.principals p ON p.id=s.principal_id
          WHERE s.token_hash=$1 AND s.expires_at>now() AND p.active`,[digest(value)]);
        if(!s)throw new HttpError(401,'Please sign in');
        const {rows:memberships}=await c.query('SELECT organisation_id,facility_id,section,role FROM hub_identity.memberships WHERE principal_id=$1 AND active ORDER BY organisation_id,facility_id,section',[s.principal_id]);
        return {...s,memberships};
      });
    },
    async logout(req){const value=cookieValue(req,cookieName);if(value)await transaction(pool,c=>c.query('DELETE FROM hub_identity.sessions WHERE token_hash=$1',[digest(value)]));return cookie('',0);}
  };
}
export async function createOidcLogin(pool,sessions,{issuer,clientId,clientSecret,origin,fetcher}){
  const server=new URL(issuer);if(server.protocol!=='https:'||server.username||server.password)throw Error('OIDC issuer must be HTTPS');
  if(!clientId||!clientSecret)throw Error('Approved OIDC client configuration is required');
  const config=await oidc.discovery(server,clientId,clientSecret,undefined,fetcher?{[oidc.customFetch]:fetcher}:undefined);
  oidc.enableNonRepudiationChecks(config);
  const callback=origin+'/auth/callback';
  const bindingCookie=(value,age)=>`__Host-tdsa-login=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
  return {
    async begin(){
      const state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier(),binding=token();
      const challenge=await oidc.calculatePKCECodeChallenge(verifier);
      await transaction(pool,async c=>{
        await c.query('DELETE FROM hub_identity.login_attempts WHERE expires_at<=now()');
        const {rows:[r]}=await c.query('SELECT COUNT(*)::integer AS n FROM hub_identity.login_attempts');if(r.n>=1000)throw new HttpError(429,'Please try signing in again shortly');
        await c.query("INSERT INTO hub_identity.login_attempts VALUES($1,$2,$3,$4,now()+interval '5 minutes')",[digest(state),digest(binding),verifier,nonce]);
      });
      return {url:oidc.buildAuthorizationUrl(config,{redirect_uri:callback,scope:'openid profile',code_challenge:challenge,code_challenge_method:'S256',state,nonce}).href,cookie:bindingCookie(binding,300)};
    },
    async complete(req,url){
      const state=url.searchParams.get('state'),binding=cookieValue(req,'__Host-tdsa-login');if(!state||!binding)throw new HttpError(401,'Sign-in request expired');
      const attempt=await transaction(pool,async c=>{const {rows:[r]}=await c.query('DELETE FROM hub_identity.login_attempts WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>now() RETURNING verifier,nonce',[digest(state),digest(binding)]);return r;});
      if(!attempt)throw new HttpError(401,'Sign-in request expired');
      let claims;
      try{const result=await oidc.authorizationCodeGrant(config,url,{pkceCodeVerifier:attempt.verifier,expectedState:state,expectedNonce:attempt.nonce,idTokenExpected:true});claims=result.claims();}catch{throw new HttpError(401,'Sign-in could not be verified');}
      if(!claims?.sub||!claims.exp)throw new HttpError(401,'Sign-in could not be verified');
      const principal=await transaction(pool,async c=>{const {rows:[p]}=await c.query('SELECT id FROM hub_identity.principals WHERE issuer=$1 AND subject=$2 AND active',[claims.iss,claims.sub]);return p;});
      if(!principal)throw new HttpError(403,'Your account has not been granted hub access');
      return [await sessions.create(principal.id,new Date(claims.exp*1000)),bindingCookie('',0)];
    }
  };
}
