# PhenFind: деплой на Ubuntu

Инструкция для Ubuntu 24.04 LTS. Приложение работает через Uvicorn, systemd и Nginx. HTTPS подключается после настройки домена.

Все адреса и имена ниже — примеры. Реальные IP, домены, имя владельца GitHub и данные доступа не включены.

## 1. Что заменить

| Пример | На что заменить |
|---|---|
| `203.0.113.10` | Публичный IP VPS |
| `phenfind.example.com` | Ваш домен, когда он появится |
| `YOUR_ACCOUNT/YOUR_REPOSITORY` | Владелец и имя репозитория GitHub |
| `deploy` | Пользователь Ubuntu, под которым размещается приложение |
| `/home/deploy/phenfind` | Абсолютный путь к проекту на сервере |

`127.0.0.1:8000` менять не нужно: это внутренний адрес приложения, к которому обращается Nginx.

Команды ниже выполняются на VPS, если не указано другое. Не вставляйте строки с тройными обратными кавычками в терминал.

## 2. Пользователь сервера

Для приложения используйте обычного пользователя с доступом к `sudo`. Если такой пользователь уже есть, создавать нового не нужно: подставьте его имя и домашний каталог в инструкцию.

Если вы подключились как `root` и хотите создать пользователя `deploy`:

```bash
adduser deploy
usermod -aG sudo deploy
su - deploy
```

Дальнейшие команды установки выполняйте от этого пользователя. При следующем SSH-подключении используйте настроенный для него способ входа.

## 3. Системные пакеты

```bash
sudo apt update
sudo apt install -y git python3-venv python3-pip nginx curl
python3 --version
```

Для указанных зависимостей нужен Python 3.11 или новее. В Ubuntu 24.04 системный Python подходит.

## 4. Загрузка проекта из GitHub

Сначала отправьте актуальный код и `requirements.txt` в GitHub со своего компьютера.

На сервере:

```bash
cd ~
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git phenfind
cd ~/phenfind
pwd
```

Ожидаемый путь в этом примере — `/home/deploy/phenfind`.

Для приватного репозитория предварительно настройте доступ GitHub, например SSH-ключ. Не записывайте токен в адрес репозитория или файл инструкции.

## 5. Окружение и зависимости

Содержимое `requirements.txt` для проверенной версии проекта:

```text
fastapi==0.141.1
uvicorn==0.53.0
Jinja2==3.1.6
pandas==3.0.6
pyarrow==25.0.1
```

Установка:

```bash
cd ~/phenfind
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip check
```

Активировать окружение необязательно: в командах используется прямой путь к его Python. Не переносите `.venv` с Mac на Ubuntu — создайте его на сервере.

`pyarrow` нужен в том числе для чтения сохранённых Pickle-матриц, если внутри них используются связанные с ним типы данных.

## 6. Подготовка данных

Файл `static/data/gene_phenotypes.json` исключён из Git, поэтому после клонирования его нужно создать.

Запускайте подготовку из корня проекта:

```bash
cd ~/phenfind
mkdir -p data/hpo static/data
.venv/bin/python prepare_data.py
```

Скрипт скачивает отсутствующие исходные файлы и создаёт:

- `static/data/genes_x_phenotypes_matrix.pkl.gz`;
- `static/data/diseases_x_phenotypes_matrix.pkl.gz`;
- `static/data/gene_phenotypes.json`;
- `static/data/hpo_terms.json`.

Уже существующие исходные файлы текущая функция загрузки повторно не скачивает. Для воспроизводимого результата используйте согласованный комплект HPO одного выпуска; не смешивайте старые исходники с выборочно скачанными новыми.

Проверьте, что зависимости и данные позволяют загрузить приложение:

```bash
.venv/bin/python -c "import application; print('Application loaded successfully')"
```

Файлы из `static/vendor` уже хранятся в репозитории. Повторно скачивать Bootstrap, jQuery и autocomplete при обычном деплое не требуется.

## 7. Автозапуск через systemd

Сначала проверьте абсолютные пути:

```bash
whoami
pwd
readlink -f .venv/bin/python
.venv/bin/python --version
```

Создайте сервис:

```bash
sudo nano /etc/systemd/system/phenfind.service
```

Вставьте, заменив пользователя и пути на фактические:

```ini
[Unit]
Description=PhenFind
After=network.target

[Service]
User=deploy
WorkingDirectory=/home/deploy/phenfind
ExecStart=/home/deploy/phenfind/.venv/bin/python -m uvicorn application:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

В nano: сохранить — `Ctrl+O`, затем Enter; выйти — `Ctrl+X`.

`--workers 2` запускает два процесса приложения. Каждый загружает собственные данные в RAM. Для небольшого VPS можно начать с `--workers 1`. На сервере не используйте `--reload`.

Если проект уже установлен под `root` в `/root/phenfind`, фактические значения будут `User=root`, `WorkingDirectory=/root/phenfind` и путь Python `/root/phenfind/.venv/bin/python`. Не подставляйте `/home/root`: это другой путь. Для постоянного размещения предпочтителен отдельный обычный пользователь.

Примените конфигурацию:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now phenfind
sudo systemctl status phenfind --no-pager -l
```

Дайте приложению загрузить данные, затем проверьте:

```bash
curl -I http://127.0.0.1:8000/docs
```

Ожидается `HTTP/1.1 200 OK`. Затем можно проверить главную страницу:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/
```

Она также должна вернуть `200`.

## 8. Nginx: доступ по IP и домену через HTTP

Создайте файл:

```bash
sudo nano /etc/nginx/sites-available/phenfind
```

Вставьте конфигурацию, подставив свой IP и домен:

```nginx
server {
    listen 80;
    server_name 203.0.113.10 phenfind.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 120s;
    }
}
```

Если домена пока нет, оставьте только IP:

```nginx
server_name 203.0.113.10;
```

Активируйте конфигурацию один раз:

```bash
sudo ln -s /etc/nginx/sites-available/phenfind /etc/nginx/sites-enabled/phenfind
sudo nginx -t
```

Если проверка успешна:

```bash
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

Если ссылка уже существует, повторно создавать её не нужно. Изменяйте файл в `sites-available`, проверяйте и перезагружайте Nginx.

Откройте в панели VPS входящие TCP-порты 80 и 443. Если на сервере включён UFW:

```bash
sudo ufw allow 'Nginx Full'
```

Порт 8000 наружу открывать не нужно. Nginx обращается к нему локально.

Теперь сайт должен открываться по `http://ВАШ_IP`. На обычном HTTP публичного IP текущие кнопки Copy не работают: используемый Clipboard API требует защищённого контекста.

## 9. Подключение домена и HTTPS

### 9.1. DNS

Создайте A-запись домена, указывающую на публичный IP VPS. Если настроена AAAA-запись, она также должна вести на корректно работающий IPv6-адрес сервера; иначе уберите ненужную запись.

Дождитесь, чтобы домен открывал ваш сайт по HTTP.

### 9.2. Отдельные блоки для домена и IP

Чтобы после включения HTTPS сохранить отдельный HTTP-доступ по IP, замените содержимое `/etc/nginx/sites-available/phenfind` следующим:

```nginx
server {
    listen 80;
    server_name 203.0.113.10;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name phenfind.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Примените:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 9.3. Сертификат

На сервере без ранее установленного Certbot:

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d phenfind.example.com --redirect
```

Укажите почту и примите условия в интерактивном диалоге. Certbot изменит конфигурацию домена, подключит сертификат и перенаправление с HTTP на HTTPS. Не заменяйте после этого файл старым HTTP-примером из инструкции.

Проверьте продление:

```bash
sudo /snap/bin/certbot renew --dry-run
```

Установка Certbot через Snap включает автоматическое продление.

Результат:

- `https://phenfind.example.com` — основной адрес, кнопки Copy должны работать при разрешении браузера;
- `http://ВАШ_IP` — остаётся доступным отдельно, с ограничениями HTTP;
- HTTPS по IP этой конфигурацией не настраивается: сертификат выдаётся для домена.

## 10. Обновление кода

Отправьте изменения в GitHub с рабочего компьютера. На сервере, от пользователя проекта:

```bash
cd ~/phenfind
git status --short
git pull --ff-only
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip check
sudo systemctl restart phenfind
sudo systemctl status phenfind --no-pager -l
```

Если `git pull` сообщает о локальных изменениях, сначала разберите их. Не удаляйте автоматически изменения командой `git reset --hard`: подготовка данных может менять файлы, отслеживаемые Git.

При изменении только HTML, CSS или JS повторно запускать `prepare_data.py` не нужно. После изменения JS/CSS обновите страницу без кеша: на Mac `Cmd+Shift+R`.

## 11. Пересборка данных

Пересборка может потреблять существенно больше RAM, чем обычная работа приложения. Чтобы приложение не стартовало с частично записанными файлами, на время подготовки остановите его:

```bash
cd ~/phenfind
sudo systemctl stop phenfind
.venv/bin/python prepare_data.py
```

Если подготовка завершилась успешно:

```bash
.venv/bin/python -c "import application; print('Application loaded successfully')"
sudo systemctl start phenfind
```

Во время остановки сайт недоступен. Сам по себе повторный запуск скрипта не обновляет уже скачанные исходники HPO.

## 12. Полезные команды

Статус приложения:

```bash
sudo systemctl status phenfind --no-pager -l
```

Последние ошибки:

```bash
sudo journalctl -u phenfind -n 100 --no-pager
```

Наблюдение за логами:

```bash
sudo journalctl -u phenfind -f
```

Выход из просмотра логов — `Ctrl+C`; приложение продолжит работать.

Перезапуск приложения:

```bash
sudo systemctl restart phenfind
```

После изменения файла сервиса, в том числе числа воркеров:

```bash
sudo systemctl daemon-reload
sudo systemctl restart phenfind
```

Проверка Nginx и его ошибок:

```bash
sudo nginx -t
sudo tail -n 50 /var/log/nginx/error.log
```

Свободная память и место:

```bash
free -h
df -h /
du -sh ~/phenfind
```

## 13. Частые ошибки

### 502 Bad Gateway

Nginx не получил корректный ответ от приложения. Начните с:

```bash
sudo systemctl status phenfind --no-pager -l
sudo journalctl -u phenfind -n 80 --no-pager
curl -I http://127.0.0.1:8000/docs
```

Если внутренний адрес не отвечает, сначала исправьте запуск приложения.

### `status=203/EXEC` или `Unable to locate executable`

Проверьте `ExecStart`: указанный Python должен существовать и запускаться. Частая причина — оставленный путь `/home/ubuntu/...`, хотя проект находится у другого пользователя.

Проверьте также `User` и `WorkingDirectory`. После правки обязательно выполните:

```bash
sudo systemctl daemon-reload
sudo systemctl restart phenfind
```

### `ModuleNotFoundError: No module named 'pyarrow'`

Установите зависимости в окружение проекта, а не в системный Python:

```bash
cd ~/phenfind
.venv/bin/python -m pip install -r requirements.txt
sudo systemctl restart phenfind
```

В `requirements.txt` должен присутствовать `pyarrow`. `pip check` не проверяет зависимости объектов внутри Pickle-файлов.

### `Address already in use`

Порт 8000 уже занят. Посмотрите, кем:

```bash
sudo ss -ltnp 'sport = :8000'
```

Если работает сервис PhenFind, не запускайте вторую копию Uvicorn вручную. Управляйте приложением через `systemctl restart phenfind`.

### Нет `gene_phenotypes.json` или других данных

Выполните подготовку из корня проекта по разделу 6. Если уже работает сервис, используйте порядок остановки и запуска из раздела 11.

### `Could not copy terms` / `Could not copy genes`

На публичном HTTP-адресе текущий Clipboard API недоступен. Используйте домен с HTTPS. Если ошибка остаётся на HTTPS, проверьте разрешения браузера на работу с буфером обмена.

## Официальная документация

- [Запуск FastAPI](https://fastapi.tiangolo.com/deployment/manually/)
- [Процессы и память FastAPI](https://fastapi.tiangolo.com/deployment/concepts/)
- [Certbot для Nginx через Snap](https://certbot.eff.org/instructions?os=snap&ws=nginx)
