FROM node:20-slim

WORKDIR /app

# Playwright needs these base deps to install Chromium
ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers

COPY package.json ./
RUN npm install --production

# Install Playwright Chromium + all system dependencies it needs
# --with-deps auto-detects OS and installs correct packages
RUN npx playwright-core install --with-deps chromium

COPY libs.json ./
COPY src/ ./src/

# Create artifact directories
RUN mkdir -p artifacts/.meta incoming

EXPOSE 3333

CMD ["node", "src/index.js"]
