
User Authentication {
    The user should be able to login using their google account using google oauth.
    The first time the user tries to login to the app, he is asked for the ususal google oauth consent screen. 
    
    When the user logs out, don't remove his access from google accounts, just invalidate the session.

    The google account should remember this consent for future logins unless the user explicitly revokes the app's linkage to their google account.
 
}