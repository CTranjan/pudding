const Alexa = require('ask-sdk-core');

const INTRO = 'Mensagem de Caio';
const BASE = 'https://pudding-audio-051162627683.s3.us-east-2.amazonaws.com/audio/recados';
const RECORDINGS = [
  { fromHour: 0, name: 'bom-dia' },
  { fromHour: 12, name: 'boa-tarde' },
  { fromHour: 18, name: 'boa-noite' },
].map((r) => ({ ...r, url: `${BASE}/${r.name}.mp3` }));

function saoPauloHour(now = new Date()) {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(text);
}

function recordingFor(hour) {
  return [...RECORDINGS].reverse().find((r) => hour >= r.fromHour);
}

const SILENT_INTENTS = ['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'];

const StaySilent = {
  canHandle(input) {
    return Alexa.getRequestType(input.requestEnvelope) === 'IntentRequest'
      && SILENT_INTENTS.includes(Alexa.getIntentName(input.requestEnvelope));
  },
  handle(input) {
    return input.responseBuilder.withShouldEndSession(true).getResponse();
  },
};

const PlayRecording = {
  canHandle(input) {
    const type = Alexa.getRequestType(input.requestEnvelope);
    return type === 'LaunchRequest' || type === 'IntentRequest';
  },
  handle(input) {
    const hour = saoPauloHour();
    const recording = recordingFor(hour);
    console.log(JSON.stringify({
      action: 'pudding_play',
      requestType: Alexa.getRequestType(input.requestEnvelope),
      saoPauloHour: hour,
      recording: recording.name,
    }));
    return input.responseBuilder
      .speak(`${INTRO}. <audio src="${recording.url}"/>`)
      .withShouldEndSession(true)
      .getResponse();
  },
};

const SessionEnded = {
  canHandle(input) {
    return Alexa.getRequestType(input.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(input) {
    const { reason, error } = input.requestEnvelope.request;
    console.log(JSON.stringify({ action: 'pudding_session_ended', reason, error }));
    return input.responseBuilder.getResponse();
  },
};

const LogError = {
  canHandle() {
    return true;
  },
  handle(input, error) {
    console.log(JSON.stringify({ action: 'pudding_error', message: error.message }));
    return input.responseBuilder.speak('O recado falhou.').getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(StaySilent, PlayRecording, SessionEnded)
  .addErrorHandlers(LogError)
  .lambda();
