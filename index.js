const http = require('http')
const sharp = require('sharp')
// https://6tail.cn/calendar/api.html#demo.html
const {Solar, SolarUtil, LunarMonth, Tao} = require('lunar-javascript')
const {readFileSync} = require("node:fs");


// ==============================
// HTTP
// ==============================

const HOST = '0.0.0.0'
const PORT = 4560

// ==============================
// 电子纸实际尺寸
// ==============================
//
// 你的电子纸底层仍然按照 800 × 480 接收数据。
// 不要改成 480 × 800。
//
const WIDTH = 800
const HEIGHT = 480

// ==============================
// 日历逻辑画布
// ==============================
//
// 日历本身按照竖屏设计：
// 480 × 800
//
// 最后使用 Sharp 顺时针旋转 90°：
// 480 × 800
//      ↓
// 800 × 480
//
// 然后再转换成电子纸黑/红两个 Plane。
//
const LOGICAL_WIDTH = 480
const LOGICAL_HEIGHT = 800

// ==============================
// Plane
// ==============================
//
// 800 × 480 / 8
// = 48000 字节
//
const PLANE_SIZE = WIDTH * HEIGHT / 8

const TIME_ZONE = 'Asia/Shanghai'


// ==============================
// 获取今天日期
// ==============================

function getToday() {

	const parts = new Intl.DateTimeFormat(
		'en-CA',
		{
			timeZone: TIME_ZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}
	).formatToParts(new Date())

	const result = {}

	for (const part of parts) {

		if (part.type !== 'literal') {
			result[part.type] = part.value
		}
	}

	return {
		year: Number(result.year),
		month: Number(result.month),
		day: Number(result.day),
	}
}


// ==============================
// XML 转义
// ==============================

function escapeXml(value) {

	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}


// ==============================
// 创建 SVG
// ==============================
//
// 注意：
// 这里永远按照 480 × 800 竖屏设计。
// renderEpd() 最后会旋转 90°。
//
// 所以这里看到的是正常的“竖屏日历”。
// 电子纸收到的则是旋转后的 800 × 480 数据。
//

async function createSvg() {
	const today = getToday()

	const solar = Solar.fromYmd(today.year, today.month, today.day)

	const lunar = solar.getLunar()
	const lunarMonth = LunarMonth.fromYm(lunar.getYear(), lunar.getMonth());
	const DaoLi = Tao.fromLunar(lunar)	// 道历

	const weekMatch = solar.toFullString().match(/星期[一二三四五六日]/)
	const week = weekMatch ? weekMatch[0] : ''
	let numberZh = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']
	const monthNames = [ '', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC' ];
	let weekEn = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
	weekEn = weekEn[solar.getWeek()];
	const monthZh = numberZh[solar.getMonth()] + "月" + (SolarUtil.getDaysOfMonth(today.year, today.month) === 31 ? "大" : "小");
	const monthLunarZh = numberZh[lunar.getMonth()] + "月" + (lunarMonth.getDayCount() === 30 ? "大" : "小");
	// 星期六和星期日使用红色, 其余日期使用黑色
	const color = [0, 6].indexOf(solar.getWeek()) > -1 ? 'red': 'black';


	// 节气预告
	const nextJieQi = lunar.getNextJieQi();
	let nextJieQiLine1Space = 1;
	let nextJieQiLine1 = `${nextJieQi.getSolar().getLunar().getDayInChinese()}${nextJieQi.getName()}`;
	let nextJieQiLine2 = `${nextJieQi.getSolar().getMonth()}月${nextJieQi.getSolar().getDay()}日`;
	// 判断节气是不是今天
	const todayJieQi = lunar.getCurrentJieQi();
	if (todayJieQi) {
		nextJieQiLine1 = `今日${nextJieQi.getName()}`;
		nextJieQiLine2 = `${todayJieQi.getSolar().getHour()} 时 ${todayJieQi.getSolar().getMinute()} 分`
		nextJieQiLine1Space = 8;
	}
	// 道历干支,纳音信息
	let DaoLiGanZhi = DaoLi.getLunar().getDayInGanZhi() + '日 ' + DaoLi.getLunar().getDayNaYin();
	// 今日相冲
	const todayChong = lunar.getDayShengXiao() + "日冲" + lunar.getDayChongShengXiao();
	// 每日胎神
	const todayTaiShen = lunar.getDayPositionTai().split(' ')

	// 月名 按农历月份数字映射
	const monthAlias = {
		1: '孟春', 2: '仲春', 3: '季春', 4: '孟夏', 5: '仲夏', 6: '季夏',
		7: '孟秋', 8: '仲秋', 9: '季秋', 10: '孟冬', 11: '仲冬', 12: '季冬'
	};
	// 月名月相
	const yueMingYueXiang = {
		text: monthAlias[lunar.getMonth()] + ' ' + lunar.getYueXiang(),
		size: lunar.getYueXiang().length <= 2 ? 19 : (lunar.getYueXiang().length === 3 ? 16 : 14)
	};

	const dayYi = (lunar.getDayYi().slice(0, 11) || []).join(' ')

	const dayJi = (lunar.getDayJi().slice(0, 11) || []).join(' ')
	const lunarTimes = lunar.getTimes();
	const shiChenJiXiong = [];
	for (let i = 0; i < lunarTimes.length; i++) {
		shiChenJiXiong.push(lunarTimes[i].getTianShenLuck());
	}

	// 日期x偏移量
	const dayXArr = {
		"225": [ 10,12,13,14,15,16,17,18,19 ],
		"240": [ 1,2,3,4,5,6,7,8,9,11,20,22,23,24,25,26,27,28,29,30 ],
		"250": [ 21,31 ],
	}
	let dayX = '250';
	for (const key in dayXArr) {
		if (dayXArr[key].indexOf(solar.getDay()) > -1) {
			dayX = key;
			break;
		}
	}

	// 获取天气信息
	const weatherRes = await fetch('https://nb59fevbxg.re.qweatherapi.com/weather/v1/daily/45.95/128.04?key=9868631afc6f4dedafa9d0731e02611d&days=1&localTime=true');
	let weatherJson = await weatherRes.json();
	let weatherText = '雷霆嘎巴 欧青辣少 天气缺失';
	if (weatherJson.hasOwnProperty('days') && weatherJson.days.length > 0) {
		let d = weatherJson.days[0];
		weatherText = `木兰县爱政街: ${d['daytime']['condition']['text']} ${parseInt(d['temperatureMin']['value'])}~${parseInt(d['temperatureMax']['value'])}° 紫外线: ${d['uvIndexMax']} 风速: ${parseInt(d['daytime']['windGustMax']['value'])}m/s`;
	}

return `
	<svg width="480" height="800" fill="#000" viewBox="0 0 480 800"  xmlns="http://www.w3.org/2000/svg">
		<!-- 白色背景 -->
		<rect
			x="0" y="0"
			width="480" height="800"
			fill="#ffffff"
		/>
		<!-- 顶部月 -->
		<rect
			x="10" y="10"
			width="460"
			height="32"
			fill="white"
			stroke="${color}"
			stroke-width="2"
		/>
		<path fill="${color}" transform="translate(429, 4) scale(0.044)" d="M742.391762 128.7135l0 110.25101 91.336218 0 0-35.756365-36.684504 0-0.071631-18.968004L906.581242 184.240141l0 91.676979L742.391762 275.91712l-0.054235 72.655763-37.024242-0.054235c0 0 0-145.57861 0-219.806171L65.721329 128.712477l0 165.18925 146.025795 0 0-90.122577-36.613896 0 0 35.809577-72.941266 0 0-55.348586 146.292877 0 0 110.233614c0 0 109.215424 0 164.654061 0l0 108.928898c11.251252-0.14224 72.941266 0 72.941266 0l0 128.754432 164.902724 0 0 91.12337 73.189929 0 0 109.411899c0 0 124.504642 0 182.461635 0l0 91.641163c-43.364647 0-146.097426 0-146.097426 0l0.034792-18.396999 18.414395 0 0-36.34579-54.740742 0-0.072655 109.680005 237.506299 0L961.679118 128.7135 742.391762 128.7135zM413.103084 239.590773 303.298236 239.590773l0-55.348586 109.840664 0L413.103084 239.590773zM797.0445 330.856383 906.581242 330.856383l0 91.176582L797.0445 422.032966 797.0445 330.856383zM540.803511 477.220892l0-73.852008 54.812373 0c0-49.829895 0-164.349115 0-164.349115l-54.402027 0c0 0 0 72.655763 0 109.555162-29.166273 0-73.263607 0-73.263607 0l-0.053212-164.332742L650.928654 184.242188l0.054235 292.979728C650.98289 477.220892 582.292438 477.220892 540.803511 477.220892zM705.314309 568.682977c0 0 0-105.071034 0-165.314093 19.61064 0 37.077453 0 37.077453 0l0 73.709769c0 0 49.25889 0 73.012897 0 0 33.773198 0 91.605348 0 91.605348L705.314309 568.684zM906.634454 678.327166 778.737552 678.327166l0-55.045687c0 0 61.349253 0 91.139743 0L869.877295 477.077629c11.68104 0 36.757159 0 36.757159 0L906.634454 678.327166z" />
		<path fill="${color}" transform="translate(51, 48) scale(-0.044)" d="M742.391762 128.7135l0 110.25101 91.336218 0 0-35.756365-36.684504 0-0.071631-18.968004L906.581242 184.240141l0 91.676979L742.391762 275.91712l-0.054235 72.655763-37.024242-0.054235c0 0 0-145.57861 0-219.806171L65.721329 128.712477l0 165.18925 146.025795 0 0-90.122577-36.613896 0 0 35.809577-72.941266 0 0-55.348586 146.292877 0 0 110.233614c0 0 109.215424 0 164.654061 0l0 108.928898c11.251252-0.14224 72.941266 0 72.941266 0l0 128.754432 164.902724 0 0 91.12337 73.189929 0 0 109.411899c0 0 124.504642 0 182.461635 0l0 91.641163c-43.364647 0-146.097426 0-146.097426 0l0.034792-18.396999 18.414395 0 0-36.34579-54.740742 0-0.072655 109.680005 237.506299 0L961.679118 128.7135 742.391762 128.7135zM413.103084 239.590773 303.298236 239.590773l0-55.348586 109.840664 0L413.103084 239.590773zM797.0445 330.856383 906.581242 330.856383l0 91.176582L797.0445 422.032966 797.0445 330.856383zM540.803511 477.220892l0-73.852008 54.812373 0c0-49.829895 0-164.349115 0-164.349115l-54.402027 0c0 0 0 72.655763 0 109.555162-29.166273 0-73.263607 0-73.263607 0l-0.053212-164.332742L650.928654 184.242188l0.054235 292.979728C650.98289 477.220892 582.292438 477.220892 540.803511 477.220892zM705.314309 568.682977c0 0 0-105.071034 0-165.314093 19.61064 0 37.077453 0 37.077453 0l0 73.709769c0 0 49.25889 0 73.012897 0 0 33.773198 0 91.605348 0 91.605348L705.314309 568.684zM906.634454 678.327166 778.737552 678.327166l0-55.045687c0 0 61.349253 0 91.139743 0L869.877295 477.077629c11.68104 0 36.757159 0 36.757159 0L906.634454 678.327166z" />
		<text x="100" y="37" font-size="32" fill="${color}" text-anchor="middle">${monthNames[solar.getMonth()]}</text>
		<text x="380" y="35" font-family="Arial" font-size="26" fill="${color}" text-anchor="middle">${monthZh}</text>
		<!-- 顶部年 -->
		<polyline
			points="180,10 185,5 295,5 300,10 300,42 295,47 185,47 180,42 180,10"
			fill="white"
			stroke="${color}"
			stroke-width="2"
		/>
		<text x="240" y="40" font-family="Arial" font-size="40" fill="${color}" font-weight="bold" text-anchor="middle">${solar.getYear()}</text>
		<!-- 日 -->
		<text x="${dayX}" y="340" font-family="Arial" font-size="300" fill="${color}" font-weight="bold" text-anchor="middle">${solar.getDay()}</text>
		<!-- 道曆 -->
		<text x="34" y="70" font-size="24" fill="${color}" text-anchor="middle">${DaoLi.getYear()}</text>
		<text x="80" y="68" font-size="16" fill="black" text-anchor="middle">道曆</text>
		<!-- 竖行文本 -->
		<text x="18" y="140" font-size="22" fill="${color}" text-anchor="start" writing-mode="tb">${lunar.getPengZuGan()}</text>
		<text x="458" y="140" font-size="22" fill="${color}" text-anchor="start" writing-mode="tb">${lunar.getPengZuZhi()}</text>
		<!-- 底部主框 -->
		<g transform="translate(0, 80)">
			<rect x="10" y="330" width="460" height="350" fill="white" stroke="${color}" stroke-width="2" />
			<text x="85" y="354" font-size="22" fill="${color}" font-family="Huninn" text-anchor="middle">${lunar.getYearInGanZhi()}年${monthLunarZh}</text>
			<rect x="10" y="360" width="150" height="38" fill="${color}" />
			<text x="88" y="391" font-size="34" fill="white" font-family="Huninn" font-weight="bold" stroke="white" stroke-width="1" text-anchor="middle" letter-spacing="8">
				${lunar.getDayInChinese()}日
			</text>
			<rect x="160" y="330" width="160" height="67" fill="white" stroke="${color}" stroke-width="2" />
			<text x="240" y="358" font-size="24" fill="${color}" font-family="Huninn" text-anchor="middle" letter-spacing="${nextJieQiLine1Space}">${nextJieQiLine1}</text>
			<text x="240" y="386" font-size="24" fill="${color}" font-family="Arial" text-anchor="middle">${nextJieQiLine2}</text>
			<text x="396" y="354" font-size="22" fill="${color}" font-family="Huninn" text-anchor="middle">${weekEn}</text>
			<rect x="320" y="360" width="150" height="38" fill="${color}" />
			<text x="400" y="391" font-size="34" fill="white" font-family="Huninn" font-weight="bold" stroke="white" text-anchor="middle" letter-spacing="8">
				${week}
			</text>
			<text x="30" y="414" font-size="30" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">${DaoLiGanZhi}</text>
			<!-- 时辰吉凶 -->
			<rect x="54" y="400" width="58" height="50" fill="${color}" />
			<line x1="50" y1="396" x2="50" y2="620" stroke="${color}" stroke-width="2" />
			<text x="70" y="402" font-size="22" fill="white" font-family="Huninn" text-anchor="start" writing-mode="tb">时辰</text>
			<text x="96" y="402" font-size="22" fill="white" font-family="Huninn" text-anchor="start" writing-mode="tb">吉凶</text>
			<line x1="50" y1="453" x2="380" y2="453" stroke="${color}" stroke-width="2" />
	
			<text x="125" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">子${shiChenJiXiong[0]}</text>
			<text x="147" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">丑${shiChenJiXiong[1]}</text>
			<text x="169" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">寅${shiChenJiXiong[2]}</text>
			<text x="191" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">卯${shiChenJiXiong[3]}</text>
			<text x="213" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">辰${shiChenJiXiong[4]}</text>
			<text x="235" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">巳${shiChenJiXiong[5]}</text>
			<text x="257" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">午${shiChenJiXiong[6]}</text>
			<text x="279" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">未${shiChenJiXiong[7]}</text>
			<text x="301" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">申${shiChenJiXiong[8]}</text>
			<text x="323" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">酉${shiChenJiXiong[9]}</text>
			<text x="345" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">戌${shiChenJiXiong[10]}</text>
			<text x="367" y="403" font-size="21" fill="${color}" font-family="Huninn" text-anchor="start" writing-mode="tb">亥${shiChenJiXiong[11]}</text>
	
			<!-- 吉神方位 -->
			<rect x="383" y="400" width="84" height="30" fill="${color}" />
			<text x="426" y="422" font-size="20" fill="white" font-family="Huninn" text-anchor="middle">吉神方位</text>
			<text x="426" y="452" font-size="20" fill="${color}" font-family="Huninn" text-anchor="middle">喜神${lunar.getDayPositionXiDesc()}</text>
			<text x="426" y="476" font-size="20" fill="${color}" font-family="Huninn" text-anchor="middle">福神${lunar.getDayPositionFuDesc()}</text>
			<text x="426" y="500" font-size="20" fill="${color}" font-family="Huninn" text-anchor="middle">财神${lunar.getDayPositionCaiDesc()}</text>
	
			<line x1="380" y1="396" x2="380" y2="620" stroke="${color}" stroke-width="2" />
			<line x1="380" y1="508" x2="470" y2="508" stroke="${color}" stroke-width="2" />
	
			<rect x="379" y="509" width="92" height="46" fill="${color}" />
			<text x="426" y="538" font-size="20" fill="white" font-family="Arial" text-anchor="middle">太岁${lunar.getDayPositionTaiSuiDesc()}</text>
	
			<line x1="380" y1="555" x2="470" y2="555" stroke="${color}" stroke-width="2" />
	
			<rect x="383" y="558" width="84" height="30" fill="${color}" />
			<text x="425" y="580" font-size="20" fill="white" font-family="Arial" text-anchor="middle">月名月相</text>
			<text x="425" y="610" font-size="${yueMingYueXiang.size}" fill="${color}" font-family="Arial" text-anchor="middle">${yueMingYueXiang.text}</text>
	
			<!-- 每日相煞 -->
			<rect x="51" y="454" width="84" height="30" fill="${color}" />
			<text x="92" y="475" font-size="20" fill="white" font-family="Huninn" text-anchor="middle">每日相煞</text>
			<text x="92" y="512" font-size="20" fill="${color}" font-family="Huninn" text-anchor="middle">${todayChong}</text>
	
			<!-- 每日胎神 -->
			<rect x="51" y="525" width="84" height="30" fill="${color}" />
			<text x="92" y="547" font-size="20" fill="white" font-family="Huninn" text-anchor="middle">每日胎神</text>
			<text x="92" y="579" font-size="20" fill="${color}" font-family="Huninn" text-anchor="middle" letter-spacing="6">${todayTaiShen[0]}</text>
			<text x="92" y="605" font-size="20" fill="${color}" font-family="Huninn" text-anchor="middle" letter-spacing="6">${todayTaiShen[1]}</text>
	
			<line x1="134" y1="452" x2="134" y2="620" stroke="${color}" stroke-width="2" />
	
			<!-- 太极八卦 -->
			<g transform="translate(138, 455) scale(0.16)" fill="${color}">
				<path d="M803.4816 515.84c-1.9968 159.2576-131.712 287.744-291.456 287.744S222.5664 675.0976 220.5696 515.84c-0.0256-1.2544-0.0512-2.5088-0.0512-3.7632 0-80.4864 65.2544-145.7664 145.7408-145.7664s145.7664 65.28 145.7664 145.7664 65.2544 145.7664 145.7664 145.7664 143.6928-63.2576 145.6896-142.0032z" />
				<path d="M366.2592 512.1024m-43.8016 0a43.8016 43.8016 0 1 0 87.6032 0 43.8016 43.8016 0 1 0-87.6032 0Z" fill="white" />
				<path d="M220.5184 508.16c1.9968-159.2576 131.712-287.744 291.456-287.744s289.4592 128.4864 291.456 287.744c0.0256 1.2544 0.0512 2.5088 0.0512 3.7632 0 80.4864-65.2544 145.7664-145.7408 145.7664s-145.7664-65.28-145.7664-145.7664-65.2544-145.7664-145.7664-145.7664-143.6928 63.2576-145.6896 142.0032z" fill="white" />
				<path d="M657.7408 511.8976m-43.8016 0a43.8016 43.8016 0 1 0 87.6032 0 43.8016 43.8016 0 1 0-87.6032 0Z" />
				<path d="M431.616 53.3248h163.4048v24.832H431.616zM431.616 96.4608h163.4048v24.832H431.616zM431.616 139.5968h163.4048v24.832H431.616zM161.27232 275.05408L276.8128 159.5136l17.5616 17.55904-115.5456 115.54304zM191.7696 305.56928l115.5456-115.54304 17.55904 17.55904-115.5456 115.54304zM196.67456 178.61632L246.272 129.01632l17.55648 17.5616L214.2336 196.1728zM130.75968 244.57472L179.90656 195.4304l17.55904 17.55648-49.14688 49.14688zM53.248 592.512v-163.4048h24.832v163.4048zM139.52 592.512v-163.4048h24.832v163.4048zM96.4096 429.1072h24.832v70.144h-24.832zM96.4096 523.008h24.832v69.504h-24.832z" />
				<path d="M305.50016 832.32512l-115.54304-115.54304 17.55648-17.5616 115.5456 115.5456zM195.34336 844.1856l17.5616-17.5616 49.14432 49.14944-17.55904 17.55648zM128.95744 777.8176l17.5616-17.5616 49.59744 49.6-17.5616 17.5616z" />
				<path d="M159.44704 747.28192l17.5616-17.55904 49.59744 49.6-17.5616 17.55904zM225.85856 813.71136l17.5616-17.55904 49.14432 49.14688-17.55904 17.5616z" />
				<path d="M429.0304 946.0224h70.144v24.832h-70.144zM522.9568 946.0224h69.504v24.832h-69.504zM429.0304 902.8864h70.144v24.832h-70.144zM522.9568 902.8864h69.504v24.832h-69.504z" />
				<path d="M429.0304 859.7504h70.144v24.832h-70.144zM522.9568 859.7504h69.504v24.832h-69.504z" />
				<path d="M893.2864 779.6224l-115.54304 115.54304-17.55904-17.55904 115.5456-115.54304zM796.07552 780.68992l49.14688-49.14688 17.55904 17.55904-49.14688 49.14688zM729.68192 847.104l49.6-49.60256 17.55904 17.5616-49.6 49.59744z" />
				<path d="M699.1744 816.5888l49.6-49.60256 17.55648 17.5616-49.59744 49.59744zM765.57824 750.20032l49.14688-49.14688 17.55904 17.55904-49.14688 49.14688z" />
				<path d="M927.6672 431.6672v163.4048h-24.832v-163.4048zM945.9456 431.6672h24.832v69.504h-24.832zM945.9456 524.928h24.832v70.144h-24.832z" />
				<path d="M859.6736 431.6672h24.832v69.504h-24.832zM859.6736 524.928h24.832v70.144h-24.832z" />
				<path d="M779.55328 130.8416l115.54304 115.54304-17.55648 17.5616-115.5456-115.5456zM749.0432 161.3312l115.5456 115.54304-17.55904 17.5616-115.54304-115.5456zM700.99456 209.40288l17.55904-17.5616 49.14688 49.14944-17.5616 17.55904zM766.92736 275.34336l17.5616-17.5616 49.59744 49.6-17.55904 17.5616z" />
			</g>
	
			<text x="360" y="475" font-size="24" fill="${color}" font-family="Huninn" text-anchor="start" letter-spacing="8" writing-mode="tb">百无禁忌</text>
			<text x="318" y="475" font-size="24" fill="${color}" font-family="Huninn" text-anchor="start" letter-spacing="8" writing-mode="tb">诸事皆宜</text>
	
			<!-- 宜 -->
			<circle cx="30" cy="635" r="14" fill="red" />
			<text x="30" y="642" font-size="20" fill="white" font-family="Huninn" text-anchor="middle">宜</text>
			<text x="55" y="641" font-size="16" fill="red" font-family="Huninn" text-anchor="start">
				${dayYi}
			</text>
			<line x1="10" y1="650" x2="470" y2="650" stroke="${color}" stroke-width="2" />
	
			<!-- 忌 -->
			<circle cx="30" cy="665" r="14" fill="black" />
			<text x="30" y="672" font-size="20" fill="white" font-family="Huninn" text-anchor="middle">忌</text>
			<text x="55" y="671" font-size="16" fill="black" font-family="Huninn" text-anchor="start">
				${dayJi}
			</text>
	
			<line x1="10" y1="620" x2="470" y2="620" stroke="${color}" stroke-width="2" />
	
			<!-- 天气预报 -->
			<rect x="10" y="680" width="460" height="30" fill="white" stroke="${color}" stroke-width="2" />
			<g fill="${color}" transform="translate(16, 683) scale(0.022)">
				<path d="M882.526316 286.796992q-17.323308 17.323308-42.345865 17.323308t-42.345865-17.323308q-18.285714-18.285714-18.285714-42.827068t18.285714-42.827068l42.345865-42.345865q17.323308-17.323308 42.345865-17.323308t42.345865 17.323308q18.285714 17.323308 18.285714 42.345865t-18.285714 43.308271zM250.225564 611.12782q-3.849624-16.360902-6.255639-33.684211t-2.406015-35.609023q0-61.593985 23.578947-116.451128t64.481203-95.278195 95.278195-64 116.932331-23.578947q72.180451 0 132.330827 30.796992t101.533835 82.766917q-31.759398 6.736842-61.593985 14.43609t-57.744361 23.097744q-24.06015-19.24812-52.451128-27.428571t-62.075188-8.180451q-38.496241 0-71.699248 14.43609t-58.225564 39.458647-39.458647 58.706767-14.43609 71.218045q0 27.909774 6.736842 49.082707-30.796992 0-58.706767 5.293233t-55.819549 14.917293zM541.834586 180.932331q-25.022556 0-42.827068-17.804511t-17.804511-42.827068l0-59.669173q0-25.022556 17.804511-42.827068t42.827068-17.804511 42.827068 17.804511 17.804511 42.827068l0 59.669173q0 25.022556-17.804511 42.827068t-42.827068 17.804511zM158.796992 244.451128q-18.285714-18.285714-18.285714-43.308271t18.285714-42.345865q17.323308-17.323308 42.345865-17.323308t42.345865 17.323308l42.345865 42.345865q18.285714 18.285714 18.285714 42.827068t-18.285714 42.827068q-17.323308 17.323308-42.345865 17.323308t-42.345865-17.323308zM853.654135 421.533835q69.293233 0 132.81203 27.428571t111.639098 74.105263 76.511278 109.233083 28.390977 131.849624q0 56.781955-12.511278 100.090226t-37.533835 88.541353q-12.511278 22.135338-27.909774 35.609023t-32.240602 21.654135-34.165414 11.067669-34.646617 2.887218l-783.398496 0q-21.172932 0-42.345865-13.954887t-38.496241-35.12782-27.909774-47.157895-10.586466-50.045113q0-103.93985 56.781955-159.759398t150.135338-55.819549q22.135338 0 39.458647 2.887218t32.240602 8.180451 29.834586 13.954887 32.240602 20.210526q10.586466-59.669173 42.345865-111.639098t82.285714-90.947368 117.894737-61.112782 149.172932-22.135338zM1024 905.62406q22.135338-6.736842 42.345865-42.345865t20.210526-99.12782q0-48.120301-17.323308-89.503759t-48.120301-71.218045-72.180451-46.676692-89.503759-16.842105-84.210526 7.699248-63.037594 19.24812-45.233083 25.984962-30.796992 26.947368q-12.511278 13.473684-25.022556 31.759398t-22.135338 38.496241-14.43609 40.421053-1.924812 35.609023q3.849624 27.909774-10.586466 47.157895t-37.052632 27.428571-47.639098 3.849624-42.345865-23.578947-41.864662-29.834586-61.112782-10.586466q-29.834586 0-48.601504 4.330827t-29.353383 13.473684-14.43609 23.097744-3.849624 32.240602q0 15.398496 6.736842 25.503759t17.804511 15.879699 24.541353 8.180451 26.947368 2.406015l712.180451 0zM179.969925 541.834586q0 25.022556-17.323308 42.827068t-42.345865 17.804511l-60.631579 0q-25.022556 0-42.345865-17.804511t-17.323308-42.827068 17.323308-42.345865 42.345865-17.323308l60.631579 0q25.022556 0 42.345865 17.323308t17.323308 42.345865z" />
			</g>
			<text x="55" y="701" font-size="16" fill="${color}" font-family="Huninn" text-anchor="start">
				${weatherText}
			</text>
		</g>
	
	
	</svg>
`
}


// ==============================
// 判断像素颜色
// ==============================
//
// 返回：
// black
// red
// white
//

function getPixelType(r, g, b) {

	// 红色

	if (
		r > 150 &&
		r > g * 1.5 &&
		r > b * 1.5
	) {

		return 'red'
	}


	// 黑色

	if (
		r < 128 &&
		g < 128 &&
		b < 128
	) {

		return 'black'
	}


	// 其它全部认为白色

	return 'white'
}

function readSvg() {
	return readFileSync("./calendar.svg", "utf8").toString();
}


// ==============================
// SVG → 电子纸数据
// ==============================

async function renderEpd() {

	const svg = await createSvg()


	// ==================================================
	// 非常重要
	// ==================================================
	//
	// SVG：
	//
	//       480 × 800
	//       竖屏
	//
	//              ↓
	//
	//       rotate(90)
	//
	//              ↓
	//
	//       800 × 480
	//       电子纸实际方向
	//
	//              ↓
	//
	//       黑色 Plane
	//       48000 bytes
	//
	//              +
	//
	//       红色 Plane
	//       48000 bytes
	//
	//              ↓
	//
	//       总计 96000 bytes
	//
	// ==================================================

	const result =
		await sharp(
			Buffer.from(svg)
		)

			// 竖屏 → 横向电子纸数据
			.rotate(90)

			// 确保最终尺寸严格为 800 × 480
			.resize(
				WIDTH,
				HEIGHT
			)

			// 去掉 Alpha
			.removeAlpha()

			// RGB 原始数据
			.raw()

			.toBuffer({
				resolveWithObject: true
			})


	const data = result.data


	// ==============================
	// 检查最终尺寸
	// ==============================

	if (
		result.info.width !== WIDTH ||
		result.info.height !== HEIGHT ||
		result.info.channels !== 3
	) {

		throw new Error(
			`图像尺寸错误: ${result.info.width}x${result.info.height}, channels=${result.info.channels}`
		)
	}


	// ==============================
	// 创建两个 Plane
	// ==============================

	// 默认全部 1 = 白色

	const blackPlane =
		Buffer.alloc(
			PLANE_SIZE,
			0xff
		)

	const redPlane =
		Buffer.alloc(
			PLANE_SIZE,
			0xff
		)


	// ==============================
	// RGB → 黑 / 红 Plane
	// ==============================

	for (
		let y = 0;
		y < HEIGHT;
		y++
	) {

		for (
			let x = 0;
			x < WIDTH;
			x++
		) {

			const rgbIndex =
				(
					y * WIDTH +
					x
				) * 3


			const r =
				data[rgbIndex]

			const g =
				data[rgbIndex + 1]

			const b =
				data[rgbIndex + 2]


			const type =
				getPixelType(
					r,
					g,
					b
				)


			const pixelIndex =
				y * WIDTH + x


			// 每 8 个像素一个字节

			const byteIndex =
				Math.floor(
					pixelIndex / 8
				)


			// MSB First

			const bitIndex =
				7 -
				(
					pixelIndex % 8
				)


			// ==========================
			// 黑色
			// ==========================

			if (type === 'black') {

				blackPlane[byteIndex] &=
					~(
						1 << bitIndex
					)
			}


				// ==========================
				// 红色
			// ==========================

			else if (
				type === 'red'
			) {

				redPlane[byteIndex] &=
					~(
						1 << bitIndex
					)
			}
		}
	}


	// ==============================
	// 黑 Plane + 红 Plane
	// ==============================

	return Buffer.concat([
		blackPlane,
		redPlane
	])
}


// ==============================
// HTTP Server
// ==============================

const server =
	http.createServer(
		async (req, res) => {

			try {

				const url =
					new URL(
						req.url || '/',
						`http://${req.headers.host || 'localhost'}`
					)


// ==================================================
// ESP32 获取电子纸数据
// ==================================================
//
// GET /epd
//
// 返回：
//
// 48000 黑色
// +
// 48000 红色
//
// = 96000 bytes
//

				if (
					url.pathname === '/epd'
				) {

					const buffer =
						await renderEpd()


					res.writeHead(
						200,
						{

							'Content-Type':
								'application/octet-stream',

							'Content-Length':
							buffer.length,

							'Cache-Control':
								'no-cache, no-store, must-revalidate',

							'Access-Control-Allow-Origin':
								'*'
						}
					)


					res.end(
						buffer
					)


					console.log(
						`/epd -> ${buffer.length} bytes`
					)


					return
				}


// ==================================================
// 浏览器预览
// ==================================================
//
// GET /epd.png
//
// 同样：
//
// 480 × 800
//      ↓
// rotate(90)
//      ↓
// 800 × 480
//

				if (url.pathname === '/epd.png') {

					const svg = await createSvg()

					const png =
						await sharp(
							Buffer.from(svg)
						)
							// 浏览器预览保持正常竖屏
							.resize(
								LOGICAL_WIDTH,
								LOGICAL_HEIGHT
							)
							.png()
							.toBuffer()

					res.writeHead(
						200,
						{
							'Content-Type':
								'image/png',

							'Content-Length':
							png.length,

							'Cache-Control':
								'no-cache'
						}
					)

					res.end(png)

					return
				}


// ==================================================
// 健康检查
// ==================================================

				if (
					url.pathname === '/health'
				) {

					const body =
						JSON.stringify({

							success:
								true,

							width:
							WIDTH,

							height:
							HEIGHT,

							logicalWidth:
							LOGICAL_WIDTH,

							logicalHeight:
							LOGICAL_HEIGHT,

							blackPlane:
							PLANE_SIZE,

							redPlane:
							PLANE_SIZE,

							total:
								PLANE_SIZE * 2
						})


					res.writeHead(
						200,
						{

							'Content-Type':
								'application/json',

							'Content-Length':
								Buffer.byteLength(body)
						}
					)


					res.end(
						body
					)


					return
				}


// ==================================================
// 404
// ==================================================

				res.writeHead(404)

				res.end(
					'Not Found'
				)

			} catch (error) {

				console.error(
					error
				)


				const body =
					JSON.stringify({

						success:
							false,

						error:
							error instanceof Error
								? error.message
								: String(error)
					})


				res.writeHead(
					500,
					{
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
					}
				)


				res.end(
					body
				)
			}
		}
	)


// ==============================
// 启动服务器
// ==============================

server.listen(
	PORT,
	HOST,
	() => {

		console.log('')

		console.log(
			'=============================='
		)

		console.log(
			' EPD Server'
		)

		console.log(
			'=============================='
		)

		console.log(
			`浏览器预览: http://localhost:${PORT}/epd.png`
		)

		console.log(
			`EPD下载:     http://localhost:${PORT}/epd`
		)

		console.log(
			`Health:      http://localhost:${PORT}/health`
		)

		console.log(
			'=============================='
		)

		console.log('')
	}
)