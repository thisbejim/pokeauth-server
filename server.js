var express = require('express');
var app = express();
var pogobuf = require('pogobuf');
var details = require('./details.json');
var fetch = require('node-fetch');
import * as openpgp from 'openpgp';

var async = require('asyncawait/async');
var await = require('asyncawait/await');

var Queue = require('firebase-queue');
var firebase = require('firebase');
import Cron from './firebase-cron';

const admin = firebase.initializeApp({
  serviceAccount: 'pokeauth.json',
  databaseURL: 'https://pokeauth.firebaseio.com'
}, 'admin');

const database = admin.database();

const clientApp = firebase.initializeApp({
  apiKey: 'AIzaSyDIO0qyF90wiDcg2uYXVQf_RuJnOLlbr68',
  authDomain:'pokeauth.firebaseapp.com',
  databaseUrl: 'https://pokeauth.firebaseio.com',
}, 'client');

const privKey = process.env.PRIVKEY;
const pubKey = process.env.PUBKEY;
const pass = process.env.PASS;

const decrypt = async(encrypted) => {
  try {
    const priv = openpgp.key.readArmored(privKey);
    await priv.keys[0].decrypt(pass);
    const options = {
      message: openpgp.message.readArmored(encrypted),
      publicKeys: openpgp.key.readArmored(pubKey).keys,
      privateKey: priv.keys[0]
    };
    const plaintext = await openpgp.decrypt(options);
    return plaintext.data;
  } catch (e) {
    console.log(e);
  }
}

// login for Pokemon Trainer Club
const getPtcToken = async(userName, password) => {
  try {
    const login = new pogobuf.PTCLogin();
    const token = await login.login(userName, password);
    return token
  } catch(e) {
    console.log('ptc error', e);
  }
}

// login for Google accounts
const getMasterToken = async(email, password) => {
  try {
    const login = new pogobuf.GoogleLogin();
    const authData = await login.getMasterToken(email, password);
    return authData.masterToken
  } catch(e) {
    console.log('google first login error', e);
  }
}

const loginWithToken = async(email, masterToken) => {
  try {
    const login = new pogobuf.GoogleLogin();
    const token = await login.loginWithToken(email, masterToken);
    return token
  } catch(e) {
    console.log('google login with token error', e);
  }
}

const errorCreatingAccount = async(email, password, resolve) => {
  try {
    console.log('Error creating account, removing user.');
    const auth = clientApp.auth();
    await auth.signInWithEmailAndPassword(email, password);
    await auth.currentUser.delete();
    resolve();
  } catch (e) {
    console.log(e)
  }
}

app.listen(process.env.PORT || 5000, function () {
  console.log('PokéAuth server running.');
  // set up cron jobs for refreshing tokens
  const ref = database.ref();
  const refreshRef = database.ref('refresh');
  const cron = new Cron(ref, refreshRef);
  const done = (e) => e;
  const error = (e) => console.log(e);
  cron.run(done, error);

  const refreshQueue = new Queue(cron.queue, async(data, progress, resolve, reject) => {
    console.log(`Refreshing token for user: ${data.uid}`);
    let accessToken;
    if (data.provider === 'google') {
      const email = await decrypt(data.email);
      accessToken = await loginWithToken(email, data.masterToken);
    } else {
      const userName = await decrypt(data.userName);
      const password = await decrypt(data.password);
      accessToken = await getPtcToken(userName, password);
    }
    if (!accessToken) {
      console.log(`Error refreshing token for user: ${data.uid}`);
      resolve();
    }
    database.ref('users').child(data.uid).child('access').update({ accessToken });
    console.log(`Successfully refreshed token for user: ${data.uid}`);
    resolve();
  });

  const tokenRef = database.ref('tokens');
  const tokenQueue = new Queue(tokenRef, async(data, progress, resolve, reject) => {

    console.log(`Begin account creation for user: ${data.uid}`);
    progress(10);

    let masterToken;
    let accessToken;

    const password = await decrypt(data.password);
    progress(20);
    const email = await decrypt(data.email);
    progress(30);

    if (data.provider === 'google') {
      masterToken = await getMasterToken(email, password);
      accessToken = await loginWithToken(email, masterToken);
    } else {
      const userName = await decrypt(data.userName);
      accessToken = await getPtcToken(userName, password);
    }


    if (!accessToken) {
      await errorCreatingAccount(email, password, resolve);
      return;
    }
    console.log('Successfully generated the access token.')

    progress(60);
    // create cronjobs for regular token refresh
    // for Google we store: encrypted email and masterToken, allowing us to generate access tokens.
    // for PTC we store encrypted email and password, allowing us to generate access tokens.
    cron.addJob('*/20 * * * *', data.uid,
      {
        email: data.email,
        userName: data.userName,
        password: data.provider === 'ptc' ? data.password : '',
        provider: data.provider,
        uid: data.uid,
        masterToken: masterToken || '',
      }
    );
    progress(80);


    const user = {
      access: {
        accessToken,
        provider: data.provider,
      },
      uid: data.uid,
    }
    await database.ref('users').child(data.uid).set(user);
    console.log(`Successfully created account for user: ${data.uid}`)
    progress(100);
    resolve();
  });

  const removeUserRef = database.ref('removeUser');
  const removeUserQueue = new Queue(removeUserRef, async(data, progress, resolve, reject) => {
    console.log(`\nRemoving user: ${data.uid}`);
    await database.ref('users').child(data.uid).remove();
    await database.ref('refresh').child('jobs').child(data.uid).remove();
    console.log(`Successfully removed user: ${data.uid}`);
    resolve();
  });

});
