# ValuFlow backend (FastAPI). 컨테이너 호스트(Render · Fly.io · Cloud Run · Railway 등)에서 실행한다.
#   docker build -t valuflow-api backend && docker run -p 8000:8000 --env-file backend/.env valuflow-api
# 한글 PDF 용 폰트는 OS 패키지(fonts-nanum)로 설치한다: 폰트 파일을 저장소에 넣지 않는다 (app/report/fonts.py 의 후보 경로).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends fonts-nanum && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt     # reranker(fastembed, ~1.1GB 모델)는 설치하지 않는다: production 기본은 Hybrid

COPY app app
COPY alembic alembic
COPY alembic.ini .

ENV APP_ENV=production PYTHONUNBUFFERED=1 PORT=8000
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import os,urllib.request as u; u.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health', timeout=4)"

# 시작할 때 migration 을 적용한다 (instance 가 하나인 데모 기준. 여러 instance 로 늘리면 migration 을 배포 단계로 분리한다).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:get_app --factory --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
