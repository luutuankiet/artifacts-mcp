FROM node:20-alpine

WORKDIR /app

COPY package.json ./

# esbuild ships platform-specific binaries; npm install handles it on Alpine
RUN npm install --production

COPY libs.json ./
COPY src/ ./src/

# Create artifact directories
RUN mkdir -p artifacts/.meta incoming

EXPOSE 3333

CMD ["node", "src/index.js"]
