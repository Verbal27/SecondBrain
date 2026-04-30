.PHONY: install dev build up down logs test prod-up prod-down

install:
	cd backend && pip install -e .
	cd frontend && npm install

dev:
	docker-compose up --build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

test:
	cd backend && pytest
	cd frontend && npm run test

prod-up:
	docker-compose -f docker-compose.prod.yml up --build -d

prod-down:
	docker-compose -f docker-compose.prod.yml down