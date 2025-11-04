FROM python:3.12-slim

WORKDIR /bletomqtt

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]