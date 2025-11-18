FROM python:3.12-slim

WORKDIR /bletomqtt

# Install BlueZ and required system packages for BLE
RUN apt-get update && apt-get install -y \
    bluez \
    dbus \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]