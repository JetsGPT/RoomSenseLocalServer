FROM node:20.11.1
WORKDIR /webserver

# Install openssl for secret generation
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

COPY . .

# Copy and make scripts executable
COPY scripts/ /webserver/scripts/
RUN chmod +x /webserver/scripts/*.sh

# Create secrets directory for file-based secrets (non-swarm mode)
RUN mkdir -p /webserver/secrets

# Use startup script instead of direct node command
CMD [ "/webserver/scripts/start.sh" ]