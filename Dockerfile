# WebAppGen - Multi-platform App Generator for Websites
# Multi-platform packaging container for Linux (AppImage, DEB, RPM), Windows (.exe) and Android (.apk)
FROM node:20-bookworm-slim

# Set non-interactive environment
ENV CI=true \
    DEBIAN_FRONTEND=noninteractive

# Install runtime and build dependencies on Debian:
# - bash, curl, wget, git, unzip, tar, file, ca-certificates
# - openjdk-17-jdk-headless (JDK for Android SDK and Gradle builds)
# - wine, wine32, wine64 (Wine environment for Windows .exe and Electron packaging)
# - python3, make, g++, pkg-config (native build tools)
# - fuse, libfuse2, rpm (Linux packaging tools)
# - libvips-dev (Sharp image processing)
# - rustc, cargo, libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev, libssl-dev (for Tauri builds)
RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      curl \
      wget \
      git \
      unzip \
      tar \
      file \
      ca-certificates \
      openjdk-17-jdk-headless \
      wine \
      wine32 \
      wine64 \
      python3 \
      make \
      g++ \
      pkg-config \
      fuse \
      libfuse2 \
      rpm \
      libvips-dev \
      rustc \
      cargo \
      libssl-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libwebkit2gtk-4.1-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure Java and Android SDK Environment
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/root/.gradle

ENV PATH=$PATH:$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Download and install Android Command Line Tools & essential SDK components for Capacitor
ARG ANDROID_CMDLINE_TOOLS_URL=https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools /tmp/cmdline-tools && \
    wget -q ${ANDROID_CMDLINE_TOOLS_URL} -O /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools && \
    mv /tmp/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools && \
    yes | sdkmanager --licenses >/dev/null 2>&1 || true && \
    sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# Install global CLI tools for Capacitor and Tauri
RUN npm install -g @capacitor/cli @tauri-apps/cli

# Set up working directory
WORKDIR /app

# Configure cache directories
ENV ELECTRON_CACHE=/app/.electron-cache \
    ELECTRON_BUILDER_CACHE=/app/.electron-builder-cache \
    PORT=3000

# Clone repository from GitHub (optional override) or copy local files
ARG REPO_URL=https://github.com/asabino2/webappgen.git
ARG BRANCH=main
RUN git clone --depth 1 --branch ${BRANCH} ${REPO_URL} . || true
COPY . /app

# Install npm dependencies
RUN npm install

# Create persistent storage directories
RUN mkdir -p /app/builds /app/.electron-cache /app/.electron-builder-cache /root/.gradle

# Expose web server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/info || exit 1

# Start the application
CMD ["node", "server.js"]
