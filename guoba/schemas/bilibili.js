/**
 * Bilibili Guoba配置面板
 */
export const bilibiliSchema = {
  // 基础配置
  basic: {
    title: 'B站解析 - 基础配置',
    cfg: {
      enable: {
        title: '启用B站解析',
        key: 'basic.enable',
        type: 'switch',
        def: true,
        desc: '是否启用B站视频/动态解析功能'
      },
      cooldown: {
        title: '解析冷却时间',
        key: 'basic.cooldown',
        type: 'number',
        min: 0,
        max: 600,
        def: 180,
        desc: '同一视频/动态的解析冷却时间（秒），0表示无冷却'
      }
    }
  },

  // 视频配置
  video: {
    title: 'B站解析 - 视频配置',
    cfg: {
      quality: {
        title: '默认画质',
        key: 'video.quality',
        type: 'select',
        def: 64,
        options: [
          { label: '360P 流畅', value: 16 },
          { label: '480P 清晰', value: 32 },
          { label: '720P 高清', value: 64 },
          { label: '720P60 高帧率', value: 74 },
          { label: '1080P 高清', value: 80 },
          { label: '1080P+ 高码率 (需大会员)', value: 112 },
          { label: '1080P60 高帧率 (需大会员)', value: 116 },
          { label: '4K 超清 (需大会员)', value: 120 }
        ],
        desc: '默认下载画质，高画质需要大会员权限'
      },
      durationLimit: {
        title: '时长限制',
        key: 'video.durationLimit',
        type: 'number',
        min: 0,
        max: 36000,
        def: 3600,
        desc: '视频时长限制（秒），超过则只发信息不下载。0表示无限制'
      },
      fileSizeLimit: {
        title: '文件大小限制',
        key: 'video.fileSizeLimit',
        type: 'number',
        min: 0,
        max: 1000,
        def: 200,
        desc: '文件大小限制（MB），超过则不下载。0表示无限制'
      },
      sendThreshold: {
        title: '群文件阈值',
        key: 'video.sendThreshold',
        type: 'number',
        min: 10,
        max: 200,
        def: 100,
        desc: '超过此大小（MB）的视频上传为群文件'
      }
    }
  },

  // 智能画质配置
  smartQuality: {
    title: 'B站解析 - 智能画质',
    cfg: {
      enable: {
        title: '启用智能画质',
        key: 'video.smartQuality.enable',
        type: 'switch',
        def: true,
        desc: '根据文件大小自动降低画质'
      },
      threshold: {
        title: '降级触发阈值',
        key: 'video.smartQuality.threshold',
        type: 'number',
        min: 10,
        max: 500,
        def: 100,
        desc: '视频超过此大小（MB）时尝试降级'
      },
      targetSize: {
        title: '目标大小',
        key: 'video.smartQuality.targetSize',
        type: 'number',
        min: 10,
        max: 200,
        def: 80,
        desc: '降级后尝试达到的目标大小（MB）'
      },
      showNotice: {
        title: '显示降级提示',
        key: 'video.smartQuality.showNotice',
        type: 'switch',
        def: true,
        desc: '发生画质降级时显示提示消息'
      }
    }
  },

  // 分P配置
  multiPage: {
    title: 'B站解析 - 分P配置',
    cfg: {
      timeout: {
        title: '选择超时',
        key: 'multiPage.timeout',
        type: 'number',
        min: 30,
        max: 600,
        def: 300,
        desc: '分P选择等待超时时间（秒）'
      },
      autoFirstPage: {
        title: '自动第一P',
        key: 'multiPage.autoFirstPage',
        type: 'switch',
        def: false,
        desc: '多P视频自动播放第一P而不询问'
      }
    }
  },

  // 显示配置
  display: {
    title: 'B站解析 - 显示配置',
    cfg: {
      showCover: {
        title: '显示封面',
        key: 'display.showCover',
        type: 'switch',
        def: true,
        desc: '是否显示视频封面图片'
      },
      showStats: {
        title: '显示统计',
        key: 'display.showStats',
        type: 'switch',
        def: true,
        desc: '是否显示播放量、点赞等统计数据'
      },
      showDesc: {
        title: '显示简介',
        key: 'display.showDesc',
        type: 'switch',
        def: true,
        desc: '是否显示视频简介'
      },
      descMaxLength: {
        title: '简介最大长度',
        key: 'display.descMaxLength',
        type: 'number',
        min: 50,
        max: 500,
        def: 120,
        desc: '视频简介显示的最大字符数'
      },
      showSummary: {
        title: '显示AI摘要',
        key: 'display.showSummary',
        type: 'switch',
        def: false,
        desc: '是否显示B站AI生成的视频摘要'
      },
      commentCount: {
        title: '评论数量',
        key: 'display.commentCount',
        type: 'number',
        min: 1,
        max: 20,
        def: 10,
        desc: '评论区显示条数'
      }
    }
  },

  // 动态配置
  dynamic: {
    title: 'B站解析 - 动态配置',
    cfg: {
      enable: {
        title: '启用动态解析',
        key: 'dynamic.enable',
        type: 'switch',
        def: true,
        desc: '是否启用B站动态解析'
      },
      sendImages: {
        title: '发送图片',
        key: 'dynamic.sendImages',
        type: 'switch',
        def: true,
        desc: '是否发送动态中的图片'
      },
      imageLimit: {
        title: '图片数量限制',
        key: 'dynamic.imageLimit',
        type: 'number',
        min: 0,
        max: 20,
        def: 5,
        desc: '单条动态最多发送的图片数量，0表示不限制'
      }
    }
  },

  // 互动配置
  interact: {
    title: 'B站解析 - 互动配置',
    cfg: {
      enable: {
        title: '启用互动功能',
        key: 'interact.enable',
        type: 'switch',
        def: true,
        desc: '是否启用点赞、投币、收藏等互动功能'
      },
      defaultFavFolder: {
        title: '默认收藏夹',
        key: 'interact.defaultFavFolder',
        type: 'number',
        min: 1,
        max: 100,
        def: 1,
        desc: '收藏视频时使用的收藏夹序号'
      }
    }
  },

  // 推送配置
  push: {
    title: 'B站解析 - 推送配置',
    cfg: {
      enable: {
        title: '启用视频推送',
        key: 'push.enable',
        type: 'switch',
        def: true,
        desc: '是否启用UP主视频更新推送'
      },
      interval: {
        title: '检查间隔',
        key: 'push.interval',
        type: 'number',
        min: 1,
        max: 60,
        def: 3,
        desc: '检查UP主更新的间隔时间（分钟）'
      }
    }
  },

  // 链接配置
  link: {
    title: 'B站解析 - 链接配置',
    cfg: {
      showOriginal: {
        title: '显示原链接',
        key: 'link.showOriginal',
        type: 'switch',
        def: true,
        desc: '解析后是否发送原B站链接'
      }
    }
  }
}

export function getBilibiliConfigSchema() {
  return Object.values(bilibiliSchema)
}
