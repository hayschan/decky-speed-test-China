from __future__ import annotations

import asyncio
import functools
import hashlib
import http.cookiejar
import json
import os
import re
import secrets
import ssl
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import decky


_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 "
    "Decky-University-Speedtest/2.0"
)
_HTTPS_TIMEOUT_SECONDS = 30
_NUAA_TIMEOUT_SECONDS = 8
_MAX_HISTORY_RECORDS = 50
_SYSTEM_CA_BUNDLE_PATHS = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/ssl/cert.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
)

_SERVERS = {
    "ustc": {
        "name": "中国科学技术大学",
        "urls": {
            "auto": "https://test.ustc.edu.cn/",
            "ipv4": "https://test.ustc.edu.cn/",
            "ipv6": "https://test6.ustc.edu.cn/",
        },
    },
    "nju": {
        "name": "南京大学",
        "urls": {
            "auto": "https://test.nju.edu.cn/",
            "ipv4": "https://test.nju.edu.cn/",
            "ipv6": "https://test6.nju.edu.cn/",
        },
    },
    "nuaa": {
        "name": "南京航空航天大学",
        "urls": {
            "auto": "http://speed.nuaa.edu.cn/",
        },
    },
}

_DEFAULT_PREFERENCES = {
    "mode": "single",
    "singleServer": "ustc",
    "selectedServers": ["ustc", "nju", "nuaa"],
    "protocol": "auto",
}


def _extract_script_data(page: str, element_id: str) -> str | None:
    for quote in ('"', "'"):
        quoted_id = re.escape(f"{quote}{element_id}{quote}")
        pattern = re.compile(
            rf"<script\b[^>]*\bid\s*=\s*{quoted_id}[^>]*>(.*?)</script\s*>",
            flags=re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(page)
        if match:
            return match.group(1).strip()
    return None


def _create_ssl_context() -> ssl.SSLContext:
    for path in _SYSTEM_CA_BUNDLE_PATHS:
        if os.path.isfile(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


class _NetworkSession:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.timeout_seconds = (
            _NUAA_TIMEOUT_SECONDS
            if base_url.startswith("http://speed.nuaa.edu.cn/")
            else _HTTPS_TIMEOUT_SECONDS
        )
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            urllib.request.HTTPSHandler(context=_create_ssl_context()),
        )
        self._ready = False
        self._ready_lock = threading.Lock()

    def ensure_ready(self) -> None:
        if self._ready:
            return

        with self._ready_lock:
            if self._ready:
                return

            request = self._request(self.base_url)
            try:
                with self.opener.open(request, timeout=self.timeout_seconds) as response:
                    body = response.read(2_000_000)
                    final_url = response.geturl()
            except urllib.error.HTTPError as error:
                body = error.read(2_000_000)
                final_url = error.geturl()

            text = body.decode("utf-8", errors="replace")
            if ".within.website/" in final_url or 'id="anubis_challenge"' in text:
                self._solve_anubis(text)

            self._ready = True

    def open(
        self,
        url: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> Any:
        request = self._request(url, data=data, headers=headers)
        return self.opener.open(request, timeout=timeout or self.timeout_seconds)

    def _request(
        self,
        url: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> urllib.request.Request:
        request_headers = {
            "User-Agent": _USER_AGENT,
            "Accept": "*/*",
            "Cache-Control": "no-cache",
        }
        if headers:
            request_headers.update(headers)
        return urllib.request.Request(url, data=data, headers=request_headers)

    def _solve_anubis(self, challenge_page: str) -> None:
        raw_challenge = _extract_script_data(challenge_page, "anubis_challenge")
        if not raw_challenge:
            raise RuntimeError("南京大学节点验证页面格式发生变化")

        challenge_document = json.loads(raw_challenge)
        challenge = challenge_document["challenge"]
        difficulty = int(challenge_document["rules"]["difficulty"])
        random_data = str(challenge["randomData"])

        started = time.perf_counter()
        nonce = 0
        required_prefix = "0" * difficulty
        while True:
            digest = hashlib.sha256(f"{random_data}{nonce}".encode("utf-8")).hexdigest()
            if digest.startswith(required_prefix):
                break
            nonce += 1

        elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
        raw_base_prefix = (
            _extract_script_data(challenge_page, "anubis_base_prefix") or '""'
        )
        base_prefix = json.loads(raw_base_prefix)
        pass_url = urllib.parse.urljoin(
            self.base_url,
            f"{base_prefix}/.within.website/x/cmd/anubis/api/pass-challenge",
        )
        query = urllib.parse.urlencode(
            {
                "id": challenge["id"],
                "response": digest,
                "nonce": nonce,
                "redir": self.base_url,
                "elapsedTime": elapsed_ms,
            }
        )

        with self.opener.open(
            self._request(f"{pass_url}?{query}"),
            timeout=self.timeout_seconds,
        ) as response:
            body = response.read(2_000_000)
            final_url = response.geturl()

        if ".within.website/" in final_url or b'anubis_challenge' in body:
            raise RuntimeError("南京大学节点验证失败")


def _resolve_server(server_id: str, protocol: str) -> tuple[str, str]:
    if server_id not in _SERVERS:
        raise ValueError("未知测速节点")
    if protocol not in {"auto", "ipv4", "ipv6"}:
        raise ValueError("未知网络协议")

    urls = _SERVERS[server_id]["urls"]
    if protocol not in urls:
        raise ValueError(f"{_SERVERS[server_id]['name']}不支持指定 {protocol.upper()} 线路")

    effective_protocol = protocol
    if protocol == "auto" and server_id in {"ustc", "nju"}:
        effective_protocol = "ipv4"
    return str(urls[protocol]), effective_protocol


def _with_cache_buster(url: str, **params: Any) -> str:
    query = {key: value for key, value in params.items()}
    query["r"] = secrets.token_hex(8)
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urllib.parse.urlencode(query)}"


def _read_response(response: Any, *, require_binary: bool = False) -> bytes:
    content_type = response.headers.get("Content-Type", "").lower()
    if require_binary and "application/octet-stream" not in content_type:
        preview = response.read(512).decode("utf-8", errors="replace").strip()
        if "anubis_challenge" in preview or ".within.website" in response.geturl():
            raise RuntimeError("节点需要重新验证，请再次测速")
        raise RuntimeError("测速节点未返回下载数据")

    chunks: list[bytes] = []
    while True:
        chunk = response.read(256 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
    return b"".join(chunks)


def _latency_stats(values: list[float]) -> tuple[float, float]:
    if not values:
        raise RuntimeError("节点延迟探测失败")
    latency = statistics.median(values)
    if len(values) < 2:
        return latency, 0.0
    jitter = statistics.mean(
        abs(values[index] - values[index - 1]) for index in range(1, len(values))
    )
    return latency, jitter


def _sanitize_preferences(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    mode = source.get("mode")
    if mode not in {"single", "average"}:
        mode = _DEFAULT_PREFERENCES["mode"]

    single_server = source.get("singleServer")
    if single_server not in _SERVERS:
        single_server = _DEFAULT_PREFERENCES["singleServer"]

    protocol = source.get("protocol")
    if protocol not in {"auto", "ipv4", "ipv6"}:
        protocol = _DEFAULT_PREFERENCES["protocol"]

    raw_selected = source.get("selectedServers")
    selected_servers: list[str] = []
    if isinstance(raw_selected, list):
        for server_id in raw_selected:
            if server_id in _SERVERS and server_id not in selected_servers:
                selected_servers.append(server_id)

    if protocol != "auto":
        selected_servers = [server_id for server_id in selected_servers if server_id != "nuaa"]
        if single_server == "nuaa":
            single_server = "ustc"

    if not selected_servers:
        selected_servers = ["ustc"]

    return {
        "mode": mode,
        "singleServer": single_server,
        "selectedServers": selected_servers,
        "protocol": protocol,
    }


class Plugin:
    def __init__(self) -> None:
        self._sessions: dict[str, _NetworkSession] = {}
        self._sessions_lock = threading.Lock()

    async def _main(self) -> None:
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        decky.logger.info("University Speed Test backend loaded")

    async def _unload(self) -> None:
        self._sessions.clear()
        decky.logger.info("University Speed Test backend unloaded")

    async def get_preferences(self) -> dict[str, Any]:
        return _sanitize_preferences(
            self._read_json(self._preferences_path, _DEFAULT_PREFERENCES)
        )

    async def save_preferences(self, preferences: Any) -> dict[str, Any]:
        sanitized = _sanitize_preferences(preferences)
        self._write_json(self._preferences_path, sanitized)
        return sanitized

    async def get_history(self) -> list[dict[str, Any]]:
        history = self._read_json(self._history_path, [])
        if not isinstance(history, list):
            return []
        return [record for record in history if isinstance(record, dict)][
            :_MAX_HISTORY_RECORDS
        ]

    async def save_history(self, record: Any) -> dict[str, Any]:
        if not isinstance(record, dict):
            raise ValueError("测速记录格式无效")

        stored_record = dict(record)
        stored_record["id"] = str(
            stored_record.get("id")
            or f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
        )
        if not isinstance(stored_record.get("measuredAt"), str):
            stored_record["measuredAt"] = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            )

        history = await self.get_history()
        history = [
            existing
            for existing in history
            if existing.get("id") != stored_record["id"]
        ]
        history.insert(0, stored_record)
        self._write_json(self._history_path, history[:_MAX_HISTORY_RECORDS])
        return stored_record

    async def measure_latency(self, server_id: str, protocol: str) -> dict[str, Any]:
        return await self._run_in_thread(
            self._measure_latency_sync, server_id, protocol, 3
        )

    async def measure_download_sample(
        self, server_id: str, protocol: str, size_megabytes: float
    ) -> dict[str, Any]:
        return await self._run_in_thread(
            self._measure_download_sync,
            server_id,
            protocol,
            size_megabytes,
        )

    async def warm_up_download(self, server_id: str, protocol: str) -> None:
        await self._run_in_thread(
            self._warm_up_download_sync,
            server_id,
            protocol,
        )

    async def measure_upload_sample(
        self, server_id: str, protocol: str, size_megabytes: float
    ) -> dict[str, Any]:
        return await self._run_in_thread(
            self._measure_upload_sync,
            server_id,
            protocol,
            size_megabytes,
        )

    async def _run_in_thread(self, function: Any, *args: Any) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, functools.partial(function, *args))

    def _measure_latency_sync(
        self, server_id: str, protocol: str, count: int
    ) -> dict[str, Any]:
        base_url, effective_protocol = _resolve_server(server_id, protocol)
        session = self._get_session(base_url)
        session.ensure_ready()
        latency, jitter, public_ip = self._probe_latency(
            session, base_url, max(1, min(count, 12))
        )
        if server_id == "nuaa" and protocol == "auto" and public_ip:
            effective_protocol = "ipv6" if ":" in public_ip else "ipv4"
        return {
            "latency": latency,
            "jitter": jitter,
            "baseUrl": base_url,
            "publicIp": public_ip,
            "protocol": effective_protocol,
        }

    def _warm_up_download_sync(self, server_id: str, protocol: str) -> None:
        base_url, _ = _resolve_server(server_id, protocol)
        session = self._get_session(base_url)
        session.ensure_ready()
        self._download_once(session, base_url, 1)

    def _measure_download_sync(
        self, server_id: str, protocol: str, size_megabytes: float
    ) -> dict[str, Any]:
        if size_megabytes not in {1, 4, 8}:
            raise ValueError("无效的下载样本大小")

        base_url, _ = _resolve_server(server_id, protocol)
        session = self._get_session(base_url)
        session.ensure_ready()
        stream_count = 3

        with ThreadPoolExecutor(max_workers=stream_count + 1) as executor:
            transfer_futures = [
                executor.submit(
                    self._download_once,
                    session,
                    base_url,
                    int(size_megabytes),
                )
                for _ in range(stream_count)
            ]
            latency_future = executor.submit(self._probe_latency, session, base_url, 3)
            transfers = [future.result() for future in transfer_futures]
            loaded_latency, loaded_jitter, _ = latency_future.result()

        transferred_bytes = sum(item[0] for item in transfers)
        duration_ms = max(item[1] for item in transfers)
        bps = transferred_bytes * 8 / (duration_ms / 1000)
        return {
            "bps": bps,
            "bytes": transferred_bytes,
            "duration": duration_ms,
            "loadedLatency": loaded_latency,
            "loadedJitter": loaded_jitter,
        }

    def _measure_upload_sync(
        self, server_id: str, protocol: str, size_megabytes: float
    ) -> dict[str, Any]:
        if size_megabytes not in {0.25, 1, 4}:
            raise ValueError("无效的上传样本大小")

        base_url, _ = _resolve_server(server_id, protocol)
        session = self._get_session(base_url)
        session.ensure_ready()
        stream_count = 2
        size_bytes = int(size_megabytes * 1024 * 1024)
        payload = os.urandom(size_bytes)

        with ThreadPoolExecutor(max_workers=stream_count + 1) as executor:
            transfer_futures = [
                executor.submit(
                    self._upload_once,
                    session,
                    base_url,
                    payload,
                )
                for _ in range(stream_count)
            ]
            latency_future = executor.submit(self._probe_latency, session, base_url, 3)
            transfers = [future.result() for future in transfer_futures]
            loaded_latency, loaded_jitter, _ = latency_future.result()

        transferred_bytes = sum(item[0] for item in transfers)
        duration_ms = max(item[1] for item in transfers)
        bps = transferred_bytes * 8 / (duration_ms / 1000)
        return {
            "bps": bps,
            "bytes": transferred_bytes,
            "duration": duration_ms,
            "loadedLatency": loaded_latency,
            "loadedJitter": loaded_jitter,
        }

    def _probe_latency(
        self,
        session: _NetworkSession,
        base_url: str,
        count: int,
    ) -> tuple[float, float, str | None]:
        samples: list[float] = []
        public_ip: str | None = None
        endpoint = urllib.parse.urljoin(base_url, "backend/getIP.php")

        for _ in range(count):
            url = _with_cache_buster(endpoint, cors="true")
            started = time.perf_counter()
            try:
                with session.open(url) as response:
                    body = response.read(64 * 1024)
                duration_ms = (time.perf_counter() - started) * 1000
                samples.append(duration_ms)

                if public_ip is None and body:
                    public_ip = self._parse_public_ip(body)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
                continue

            time.sleep(0.04)

        latency, jitter = _latency_stats(samples)
        return latency, jitter, public_ip

    def _download_once(
        self,
        session: _NetworkSession,
        base_url: str,
        size_megabytes: int,
    ) -> tuple[int, float]:
        endpoint = urllib.parse.urljoin(base_url, "backend/garbage.php")
        url = _with_cache_buster(endpoint, cors="true", ckSize=size_megabytes)
        try:
            with session.open(url) as response:
                # Exclude DNS, TCP/TLS setup and server response latency. The
                # bandwidth sample should measure only delivery of the body.
                started = time.perf_counter()
                body = _read_response(response, require_binary=True)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"下载接口返回 HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"下载节点连接失败：{error.reason}") from error

        duration_ms = max(1.0, (time.perf_counter() - started) * 1000)
        if not body:
            raise RuntimeError("下载节点未返回数据")
        return len(body), duration_ms

    def _upload_once(
        self,
        session: _NetworkSession,
        base_url: str,
        payload: bytes,
    ) -> tuple[int, float]:
        endpoint = urllib.parse.urljoin(base_url, "backend/empty.php")
        url = _with_cache_buster(endpoint, cors="true")
        started = time.perf_counter()
        try:
            with session.open(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Encoding": "identity",
                },
            ) as response:
                response.read(64 * 1024)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"上传接口返回 HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"上传节点连接失败：{error.reason}") from error

        duration_ms = max(1.0, (time.perf_counter() - started) * 1000)
        return len(payload), duration_ms

    def _get_session(self, base_url: str) -> _NetworkSession:
        with self._sessions_lock:
            session = self._sessions.get(base_url)
            if session is None:
                session = _NetworkSession(base_url)
                self._sessions[base_url] = session
            return session

    @staticmethod
    def _parse_public_ip(body: bytes) -> str | None:
        try:
            value = json.loads(body.decode("utf-8", errors="replace"))
            if isinstance(value, dict):
                processed = value.get("processedString")
                if isinstance(processed, str):
                    return processed.split(" - ", 1)[0].strip()
        except json.JSONDecodeError:
            text = body.decode("utf-8", errors="replace").strip()
            return text or None
        return None

    @property
    def _preferences_path(self) -> str:
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "preferences.json")

    @property
    def _history_path(self) -> str:
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "history.json")

    @staticmethod
    def _read_json(path: str, default: Any) -> Any:
        try:
            with open(path, "r", encoding="utf-8") as file:
                return json.load(file)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return default

    @staticmethod
    def _write_json(path: str, value: Any) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        temporary_path = f"{path}.tmp"
        with open(temporary_path, "w", encoding="utf-8") as file:
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_path, path)
