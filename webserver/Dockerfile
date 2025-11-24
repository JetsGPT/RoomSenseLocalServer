FROM node:20.11.1
WORKDIR /webserver

# Install openssl for secret generation and docker CLI for swarm management
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    curl \
    gnupg \ 
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (for swarm and secret management)
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

COPY . .

# Copy init script and make executable
COPY scripts/init/init-swarm-secrets.sh /init-swarm-secrets.sh
RUN chmod +x /init-swarm-secrets.sh

# Mount Docker socket will be done at runtime
# Start Node.js application directly
CMD ["node", "src/app.js"]