"use strict";

import fs = require("fs");
import path = require("path");
import request = require("request-promise-native");


//https://docs.microsoft.com/en-us/appcenter/distribution/uploading
//https://docs.microsoft.com/en-us/appcenter/diagnostics/ios-symbolication
//https://github.com/microsoft/appcenter/issues/965

/*async function requestUserInfo(defaultRequest){
    const user = await defaultRequest({
        url: "/user",
        method: "GET",
        json: true
    });
    //console.log(user);
    return user;
}*/

/*async function requestAppsList(defaultRequest){
    const apps = await defaultRequest({
        url: "/apps",
        method: "GET",
        json: true
    });
    //console.log(apps);
    return apps;
}*/

async function uploadBuild(defaultRequest, appOwnerName, appName, buildFilePath, progressCb) {
    const uploadInfo = await defaultRequest({
        url: `/apps/${appOwnerName}/${appName}/release_uploads`,
        method: "POST",
        json: true,
        body: {
            //"release_id": 0,
            //"build_version": "1.0.0",
            //"build_number": "10"
        }
    });
    const uploadId = uploadInfo.upload_id;
    const uploadUrl = uploadInfo.upload_url;

    // Отгружаем данные
    const fileStream = fs.createReadStream(buildFilePath);
    if (progressCb) {
        fileStream.on("data", (chunk) => {
            progressCb(chunk.length);
        });
    }
    await request({
        url: uploadUrl,
        method: "POST",
        formData: { // Чтобы "Content-Type" был "multipart/form-data" в хедерах, просто указываем formData
            "ipa": fileStream
        }
    });

    // Коммит отгрузки
    const uploadCommitInfo = await defaultRequest({
        url: `/apps/${appOwnerName}/${appName}/release_uploads/${uploadId}`,
        method: "PATCH",
        json: true,
        body: {
            "status": "committed"
        }
    });
    // Параметры в выводе
    //     release_id: '17',
    //     release_url: 'v0.1/apps/Game-Insight-HQ-Organization/QC-Paradise-Island-2-Android/releases/17'

    return uploadCommitInfo;
}

async function uploadSymbols(defaultRequest, appOwnerName, appName, symbolsFilePath, progressCb) {
    // Получаем URL для отгрузки в центр
    const uploadInfo = await defaultRequest({
        url: `/apps/${appOwnerName}/${appName}/symbol_uploads`,
        method: "POST",
        json: true,
        body: {
            //"symbol_type": "Breakpad", // Android
            "symbol_type": "Apple",  // Apple
            //"client_callback": "string",
            //"file_name": "string",
            //"build": "string",
            //"version": "string"
        }
    });
    const symbolsUploadId = uploadInfo.symbol_upload_id;
    const symbolsUploadUrl = uploadInfo.upload_url;

    // Отгружаем данные
    const fileStream = fs.createReadStream(symbolsFilePath);
    if (progressCb) {
        fileStream.on("data", (chunk) => {
            progressCb(chunk.length);
        });
    }
    await request({
        url: symbolsUploadUrl,
        method: "PUT",
        headers: {
            "x-ms-blob-type": "BlockBlob"
        }
    });

    // Коммит отгрузки
    const uploadCommitInfo = await defaultRequest({
        url: `/apps/${appOwnerName}/${appName}/symbol_uploads/${symbolsUploadId}`,
        method: "PATCH",
        json: true,
        body: {
            "status": "committed"
        }
    });

    return uploadCommitInfo;
}

export async function uploadToHockeyApp(token: string, appName: string, appOwnerName: string, 
                                        buildFilePath: string, needSymbolsUploading: boolean, 
                                        symbolsFilePath: string, progressCb: (number)=>void) {
    // Базовый конфиг запроса
    const defaultRequest = request.defaults({
        baseUrl: "https://api.appcenter.ms/v0.1",
        headers: {
            "X-API-Token": token
        }
    });

    // Промисы для ожидания результата
    const promises = [];

    // Грузим билд на сервер
    const uploadBuildProm = uploadBuild(defaultRequest, appOwnerName, appName, buildFilePath, progressCb);
    promises.push(uploadBuildProm);

    // Грузим символы на сервер
    if (needSymbolsUploading) {
        const symbolsUploadProm = uploadSymbols(defaultRequest, appOwnerName, appName, symbolsFilePath, progressCb);
        promises.push(symbolsUploadProm);
    }

    return await Promise.all(promises);
}

export function isSymbolsUploadingSupported(buildFilePath: string, symbolsFilePath: string): boolean {
    // Можем грузить символы или нет?
    const needSymbolsUploading = (path.extname(buildFilePath) === ".ipa") && symbolsFilePath && (path.extname(symbolsFilePath) === ".zip");
    return needSymbolsUploading;
}
