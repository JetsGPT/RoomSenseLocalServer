FROM nodered/node-red

WORKDIR /data
COPY package.json /data
RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production
WORKDIR /usr/src/node-red

COPY settings.js /data/settings.js
COPY flows.json /data/flows.json