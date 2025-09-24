/**
 * Steam 愿望单打折监听插件
 * 每30分钟检查一次用户的 Steam 愿望单中游戏的打折信息，并在日历中显示打折游戏。
 */
function fetchEvents(config) {


    // 检查 Steam 用户名是否存在
    var steamId = config.steam_id;

    if (!steamId || steamId.trim() === "") {
        throw new Error("Steam 用户名不能为空，请在插件配置中填入您的 Steam 用户名。");
    }



    // --- 缓存逻辑 ---
    var cacheKey = "steam_wishlist_discount_v10_" + steamId;

    var cachedData = sdcl.storage.get(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    // --- Steam 愿望单打折检查逻辑 ---
    var events = [];
    try {
        // 1. 首先需要将用户名转换为Steam ID
        var steamIdUrl = "https://steamcommunity.com/id/" + steamId + "?xml=1";
        var steamIdResponse = sdcl.http.get(steamIdUrl);

        if (!steamIdResponse) {
            throw new Error("无法获取Steam用户信息，请检查您的Steam用户名是否正确。");
        }

        // 从XML响应中提取Steam ID
        var steamId64Match = steamIdResponse.match(/<steamID64>(\d+)<\/steamID64>/);
        if (!steamId64Match) {
            throw new Error("无法找到对应的Steam ID，请确认用户名正确且资料为公开。");
        }
        var steamId64 = steamId64Match[1];

        // 2. 使用Steam ID获取愿望单
        var wishlistUrl = "https://api.steampowered.com/IWishlistService/GetWishlist/v1?steamid=" + steamId64;
        var wishlistResponse = sdcl.http.get(wishlistUrl);

        if (!wishlistResponse) {
            throw new Error("无法获取愿望单数据，请检查您的愿望单是否设置为公开。");
        }

        var wishlistData = JSON.parse(wishlistResponse);

        // 新API返回格式: {"response": {"items": [...]}

        var gameItems = [];
        if (wishlistData.response && wishlistData.response.items) {
            gameItems = wishlistData.response.items;
        }



        if (gameItems.length === 0) {
            // 如果愿望单为空，创建一个提示事件
            var eventDate = new Date();
            var timezoneOffset = eventDate.getTimezoneOffset();
            eventDate.setHours(0, 0, 0, 0);
            eventDate = new Date(eventDate.getTime() - (timezoneOffset * 60 * 1000));

            events.push({
                title: "Steam 愿望单为空",
                startDate: sdcl.date.format(eventDate.getTime() / 1000),
                endDate: sdcl.date.format(eventDate.getTime() / 1000),
                color: "#666666",
                notes: "您的 Steam 愿望单中没有游戏，或者愿望单未设置为公开。",
                isAllDay: true,
                isPointInTime: true
            });

            // 缓存空结果（30分钟）
            sdcl.storage.set(cacheKey, events, 30);
            return events;
        }

        // 3. 检查愿望单中游戏的打折信息
        var discountedGames = [];
        var batchSize = 50; // 每次最多检查50个游戏
        var gamesToCheck = gameItems.slice(0, batchSize);


        for (var i = 0; i < gamesToCheck.length; i++) {
            var gameItem = gamesToCheck[i];
            var appId = gameItem.appid;

            try {
                // 获取游戏详细信息和价格
                var gameDetailUrl = "https://store.steampowered.com/api/appdetails?appids=" + appId + "&cc=cn&l=schinese&filters=price_overview,basic";
                var gameDetailResponse = sdcl.http.get(gameDetailUrl);

                if (!gameDetailResponse) {
                    continue;
                }

                var gameDetail = JSON.parse(gameDetailResponse);

                if (!gameDetail[appId] || !gameDetail[appId].success) {
                    continue;
                }

                var data = gameDetail[appId].data;


                // 检查是否有打折
                if (data.price_overview && data.price_overview.discount_percent > 0) {
                    var gameInfo = {
                        appId: appId,
                        name: data.name,
                        discountPercent: data.price_overview.discount_percent,
                        originalPrice: data.price_overview.initial_formatted || "¥" + (data.price_overview.initial / 100).toFixed(2),
                        finalPrice: data.price_overview.final_formatted || "¥" + (data.price_overview.final / 100).toFixed(2),
                        currency: data.price_overview.currency,
                        headerImage: data.header_image,
                        storeUrl: "https://store.steampowered.com/app/" + appId
                    };

                    discountedGames.push(gameInfo);
                }

                // 添加延迟避免请求过快
                if (i < gamesToCheck.length - 1) {
                    // 简单的延迟实现
                    var start = new Date().getTime();
                    while (new Date().getTime() < start + 100) {
                        // 等待100ms
                    }
                }

            } catch (gameErr) {
                continue;
            }
        }


        // 3. 创建打折游戏的日历事件
        if (discountedGames.length === 0) {
            // 如果没有打折游戏，创建一个提示事件
            var eventDate = new Date();
            var timezoneOffset = eventDate.getTimezoneOffset();
            eventDate.setHours(0, 0, 0, 0);
            eventDate = new Date(eventDate.getTime() - (timezoneOffset * 60 * 1000));

            events.push({
                title: "愿望单暂无打折游戏",
                startDate: sdcl.date.format(eventDate.getTime() / 1000),
                endDate: sdcl.date.format(eventDate.getTime() / 1000),
                color: "#4A90E2",
                notes: "已检查愿望单中的前 " + gamesToCheck.length + " 个游戏，暂时没有发现打折游戏。",
                href: "https://steamcommunity.com/id/" + steamId + "/wishlist",
                isAllDay: true,
                isPointInTime: true
            });
        } else {
            // 为每个打折游戏创建事件
            for (var j = 0; j < discountedGames.length; j++) {
                var game = discountedGames[j];

                // 设置为当天的全天事件（本地时间）
                var eventDate = new Date();
                // 获取本地时区偏移量（分钟）
                var timezoneOffset = eventDate.getTimezoneOffset();
                // 设置为当天0点本地时间，然后转换为UTC
                eventDate.setHours(0, 0, 0, 0);
                // 调整为UTC时间以正确显示
                eventDate = new Date(eventDate.getTime() - (timezoneOffset * 60 * 1000));

                var discountColor = getDiscountColor(game.discountPercent);
                var notes = "原价: " + game.originalPrice + "\n" +
                           "现价: " + game.finalPrice + "\n" +
                           "折扣: -" + game.discountPercent + "%";

                var gameEvent = {
                    title: game.name + " (-" + game.discountPercent + "%)",
                    startDate: sdcl.date.format(eventDate.getTime() / 1000),
                    endDate: sdcl.date.format(eventDate.getTime() / 1000),
                    color: discountColor,
                    notes: notes,
                    href: game.storeUrl,
                    imageURL: game.headerImage,
                    isAllDay: true,
                    isPointInTime: true
                };

                events.push(gameEvent);
            }
        }


        // 将成功获取的事件缓存30分钟
        if (events.length > 0) {
            sdcl.storage.set(cacheKey, events, 30);
        } else {
        }

    } catch (err) {
        throw new Error("Steam 愿望单插件执行失败: " + err.message);
    }

    return events;
}

/**
 * 根据折扣百分比获取对应的颜色
 */
function getDiscountColor(discountPercent) {
    if (discountPercent >= 75) {
        return "#E74C3C"; // 深红色 - 超大折扣
    } else if (discountPercent >= 50) {
        return "#E67E22"; // 橙色 - 大折扣
    } else if (discountPercent >= 25) {
        return "#F39C12"; // 黄色 - 中等折扣
    } else {
        return "#3498DB"; // 蓝色 - 小折扣
    }
}
