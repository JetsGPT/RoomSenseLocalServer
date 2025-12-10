FROM node:20.11.1
WORKDIR /webserver

# Install basic dependencies (openssl is used for cert generation in some scripts, though we use pre-generated ones usually)
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    curl \
    gnupg \ 
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Removed Docker CLI installation to reduce attack surface (Least Privilege)

COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

COPY . .

# Copy init script and make executable
COPY scripts/init/init-swarm-secrets.sh /init-swarm-secrets.sh
RUN chmod +x /init-swarm-secrets.sh

# Switch to non-root user for security
USER node

# Start Node.js application directly
CMD ["node", "src/app.js"]